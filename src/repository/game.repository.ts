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
  QuestionData,
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
      include: { team: true, category: true },
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
        questionNumber: true,
      },
    });

    if (!question) return null;

    return {
      timeToThink: question.timeToThink,
      timeToAnswer: question.timeToAnswer,
      gameId: question.round.gameId,
      questionNumber: question.questionNumber,
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
        category: true,
      },
    });

    return PlayerMapper.toParticipantDomain(rawResult);
  }

  async setParticipantDisconnected(socketId: string): Promise<number | null> {
    const participant = await this.prisma.gameParticipant.findFirst({
      where: { socketId },
      select: { gameId: true },
    });
    if (!participant) {
      return null;
    }
    await this.prisma.gameParticipant.updateMany({
      where: { socketId },
      data: { isAvailable: true, socketId: null },
    });
    return participant.gameId;
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
    submittedAt: Date,
    lateBySeconds?: number,
  ): Promise<AnswerDomain> {
    const statusId = await this.getStatusIdOrThrow(AnswerStatus.UNSET);
    const answerToSave = {
      gameParticipantId: participantId,
      questionId: questionId,
      answerText: text,
      submittedAt: submittedAt,
      statusId: statusId,
      lateBySeconds: lateBySeconds,
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
        submittedAt: submittedAt,
        statusId: statusId,
        lateBySeconds: lateBySeconds,
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
        include: { participant: true },
      });
      const updated = await tx.answer.update({
        where: { id: answerId },
        data: { statusId: newStatusId },
        include: {
          participant: { include: { team: true } },
          status: true,
        },
      });
      await tx.answerStatusHistory.create({
        data: {
          answerId: answerId,
          oldStatusId: current.statusId,
          newStatusId: newStatusId,
          changedById: adminId,
        },
      });
      return {
        socketId: current.participant.socketId,
        gameParticipantId: updated.gameParticipantId,
      };
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

  async getCorrectAnswersByGame(
    gameId: number,
  ): Promise<{ participantId: number; questionId: number }[]> {
    const correctStatusId = await this.getStatusIdOrThrow(AnswerStatus.CORRECT);

    const answers = await this.prisma.answer.findMany({
      where: {
        statusId: correctStatusId,
        participant: { gameId },
      },
      select: {
        gameParticipantId: true,
        questionId: true,
      },
    });

    return answers.map((a) => ({
      participantId: a.gameParticipantId,
      questionId: a.questionId,
    }));
  }

  async findActiveQuestionData(gameId: number): Promise<QuestionData | null> {
    const question = await this.prisma.question.findFirst({
      where: {
        round: { gameId },
        isActive: true,
      },
      select: {
        id: true,
        questionNumber: true,
        questionDeadline: true,
      },
    });
    return question
      ? {
          questionId: question?.id,
          questionNumber: question?.questionNumber,
          questionDeadline: question.questionDeadline?.getTime(),
        }
      : null;
  }

  async updateQuestionDeadline(questionId: number, deadline: Date) {
    return this.prisma.question.update({
      where: { id: questionId },
      data: { questionDeadline: deadline },
    });
  }

  async getQuestionDeadline(questionId: number) {
    const question = await this.prisma.question.findFirst({
      where: {
        id: questionId,
      },
    });
    return question?.questionDeadline?.getTime();
  }

  async getParticipantAnswerHistory(
    participantId: number,
  ): Promise<AnswerDomain[]> {
    const answers = await this.prisma.answer.findMany({
      where: { gameParticipantId: participantId },
      include: {
        question: {
          select: {
            text: true,
            answer: true,
            questionNumber: true
          },
        },
        status: true,
      },
      orderBy: { question: { questionNumber: 'asc' } },
    });

    return answers.map((a) => AnswerMapper.toDomain(a));
  }
}
