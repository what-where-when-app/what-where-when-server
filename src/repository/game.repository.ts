import {
  Injectable,
} from '@nestjs/common';
import { type Game } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  gameDetailsInclude, GameSettings,
  HostGameDetails,
} from './contracts/game.dto';
import {
  AnswerMapper, mapGameSettings,
  mapHostGameDetails,
  PlayerMapper,
} from './mappers/host-game.mapper';
import { GameId } from './contracts/common.dto';
import {
  AnswerDomain,
  AnswerStatus,
  DisputeStatus,
  GameStatus,
  ParticipantDomain,
  QuestionSettings,
} from './contracts/game-engine.dto';

@Injectable()
export class GameRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async getGameSettings(gameId: number): Promise<GameSettings | null> {
    const game = await this.findById(gameId);
    return game ? mapGameSettings(game) : null;
  }

  public async getOrderedQuestionIds(gameId: number): Promise<number[]> {
    const rounds = await this.prisma.round.findMany({
      where: { gameId },
      orderBy: { roundNumber: 'asc' },
      select: {
        questions: {
          orderBy: { questionNumber: 'asc' },
          select: { id: true },
        },
      },
    });

    return rounds.flatMap((r) => r.questions.map((q) => q.id));
  }

  public async getParticipantsByGame(
    gameId: number,
  ): Promise<ParticipantDomain[]> {
    const participants = await this.prisma.gameParticipant.findMany({
      where: { gameId },
      include: { team: true },
    });

    return participants.map(PlayerMapper.toParticipantDomain);
  }

  public async getQuestionSettings(
    questionId: number,
  ): Promise<QuestionSettings | null> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        timeToThink: true,
        timeToAnswer: true,
        round: { select: { gameId: true } },
      },
    });

    if (!question) return null;

    return {
      timeToThink: question.timeToThink,
      timeToAnswer: question.timeToAnswer,
      gameId: question.round.gameId,
    };
  }

  async getAnswersByGame(gameId: number): Promise<AnswerDomain[]> {
    const answers = await this.prisma.answer.findMany({
      where: { participant: { gameId } },
      include: {
        participant: { include: { team: true } },
        status: true,
      },
      orderBy: { submittedAt: 'asc' },
    });
    console.log(answers);
    return answers.map(AnswerMapper.toDomain);
  }

  async updateStatus(gameId: GameId, status: GameStatus): Promise<Game> {
    return this.prisma.game.update({
      where: { id: gameId },
      data: {
        status,
        modifiedAt: new Date(),
      },
    });
  }

  async teamJoinGame(
    gameId: number,
    teamId: number,
    socketId: string,
  ): Promise<ParticipantDomain> {
    const rawResult = await this.prisma.gameParticipant.update({
      where: {
        gameId_teamId: { gameId, teamId },
      },
      data: {
        isAvailable: false,
        socketId: socketId,
      },
      include: {
        team: true,
      },
    });

    return PlayerMapper.toParticipantDomain(rawResult);
  }

  async setParticipantDisconnected(socketId: string): Promise<void> {
    await this.prisma.gameParticipant.updateMany({
      where: { socketId },
      data: { isAvailable: true, socketId: null },
    });
  }

  async findById(id: number): Promise<Game | null> {
    return this.prisma.game.findUnique({ where: { id } });
  }

  async getGameStructure(gameId: number): Promise<HostGameDetails | null> {
    const row = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: gameDetailsInclude,
    });
    return row ? mapHostGameDetails(row) : null;
  }

  private async getStatusIdOrThrow(name: string): Promise<number> {
    const status = await this.prisma.answerStatus.findFirst({
      where: { name },
    });

    if (!status) {
      throw new Error(
        `Critical Error: Status "${name}" not found in database. Did you run the seed?`,
      );
    }

    return status.id;
  }

  async activateQuestion(gameId: number, questionId: number) {
    return this.prisma.$transaction([
      this.prisma.question.updateMany({
        where: { round: { gameId } },
        data: { isActive: false },
      }),
      this.prisma.question.update({
        where: { id: questionId },
        data: { isActive: true },
      }),
    ]);
  }

  async saveAnswer(
    participantId: number,
    questionId: number,
    text: string,
  ): Promise<AnswerDomain> {
    const statusId = await this.getStatusIdOrThrow(AnswerStatus.UNSET);
    const answerToSave = {
      gameParticipantId: participantId,
      questionId: questionId,
      answerText: text,
      submittedAt: new Date(),
      statusId: statusId,
    };
    const res = await this.prisma.answer.upsert({
      where: {
        gameParticipantId_questionId: {
          gameParticipantId: participantId,
          questionId: questionId,
        },
      },
      update: {
        answerText: text,
        submittedAt: new Date(),
        statusId: statusId,
      },
      create: answerToSave,
      include: {
        participant: { include: { team: true } },
        status: true,
      },
    });
    return AnswerMapper.toDomain(res);
  }

  async getAnswerById(answerId: number): Promise<AnswerDomain> {
    const answer = await this.prisma.answer.findUniqueOrThrow({
      where: { id: answerId },
      include: {
        participant: { include: { team: true } },
        status: true,
      },
    });
    return AnswerMapper.toDomain(answer);
  }

  async judgeAnswer(answerId: number, statusName: string, adminId: number) {
    const newStatusId = await this.getStatusIdOrThrow(statusName);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.answer.findUniqueOrThrow({
        where: { id: answerId },
      });
      const updated = await tx.answer.update({
        where: { id: answerId },
        data: { statusId: newStatusId },
      });
      await tx.answerStatusHistory.create({
        data: {
          answerId: answerId,
          oldStatusId: current.statusId,
          newStatusId: newStatusId,
          changedById: adminId,
        },
      });
      return updated;
    });
  }

  async createDispute(answerId: number, comment: string) {
    const disputableStatusId = await this.getStatusIdOrThrow(
      AnswerStatus.DISPUTABLE,
    );
    const openStatus = await this.prisma.disputeStatus.findFirst({
      where: { name: DisputeStatus.OPEN },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.answer.update({
        where: { id: Number(answerId) },
        data: { statusId: disputableStatusId },
      });

      return tx.dispute.create({
        data: {
          answerId: Number(answerId),
          statusId: openStatus!.id,
          comment: comment,
        },
      });
    });
  }

  async getLeaderboard(gameId: number) {
    const correctStatusId = await this.getStatusIdOrThrow(AnswerStatus.CORRECT);
    const scores = await this.prisma.answer.groupBy({
      by: ['gameParticipantId'],
      where: {
        statusId: correctStatusId,
        participant: { gameId },
      },
      _count: { id: true },
    });

    const participants = await this.prisma.gameParticipant.findMany({
      where: { gameId },
      include: { team: true },
    });

    return participants
      .map((p) => ({
        participantId: p.id,
        teamName: p.team.name,
        score: scores.find((s) => s.gameParticipantId === p.id)?._count.id || 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  async findActiveQuestionId(gameId: number): Promise<number | null> {
    const question = await this.prisma.question.findFirst({
      where: {
        round: { gameId },
        isActive: true,
      },
      select: { id: true },
    });
    return question?.id ?? null;
  }
}
