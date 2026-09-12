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
  /**
   * Cache of AnswerStatus.name -> id. Status rows are seeded once and never
   * change at runtime, so caching avoids a DB round-trip per answer write.
   */
  private readonly statusIdCache = new Map<string, Promise<number>>();

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

  /**
   * Atomically claims a (gameId, teamId) slot for a connecting socket.
   *
   * If the caller already knows its own `participantId` (a returning
   * client reconnecting after a network blip or app background/foreground
   * cycle), we reclaim by identity first — this succeeds even if the old
   * socketId is still set, since the server hasn't run the disconnect
   * handler for the stale socket yet. Without this, a brief connectivity
   * gap would race against the server's own disconnect cleanup and the
   * same team could get locked out of its own slot with "already taken".
   *
   * Otherwise (first join, or an unrecognized participantId), fall back to
   * the conditional `socketId: null` claim: only one of two concurrent
   * first-time joins for the same team can win, and the loser sees
   * `count === 0` and we throw, letting the caller surface "already taken".
   */
  async teamJoinGame(
    gameId: number,
    teamId: number,
    socketId: string,
    participantId?: number,
  ): Promise<ParticipantDomain> {
    if (participantId !== undefined) {
      const reclaim = await this.prisma.gameParticipant.updateMany({
        where: { id: participantId, gameId, teamId },
        data: {
          isAvailable: false,
          socketId: socketId,
        },
      });

      if (reclaim.count > 0) {
        const claimed = await this.prisma.gameParticipant.findUniqueOrThrow({
          where: { gameId_teamId: { gameId, teamId } },
          include: { team: true, category: true },
        });
        return PlayerMapper.toParticipantDomain(claimed);
      }
    }

    const claim = await this.prisma.gameParticipant.updateMany({
      where: {
        gameId,
        teamId,
        socketId: null,
      },
      data: {
        isAvailable: false,
        socketId: socketId,
      },
    });

    if (claim.count === 0) {
      throw new Error('Cannot join: team slot is already taken');
    }

    const claimed = await this.prisma.gameParticipant.findUniqueOrThrow({
      where: { gameId_teamId: { gameId, teamId } },
      include: { team: true, category: true },
    });

    return PlayerMapper.toParticipantDomain(claimed);
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

  /** After a full process restart no old socket ids are valid; disconnect handlers do not run for them. */
  async clearAllParticipantSockets(): Promise<number> {
    const result = await this.prisma.gameParticipant.updateMany({
      where: { socketId: { not: null } },
      data: { isAvailable: true, socketId: null },
    });
    return result.count;
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
    const cached = this.statusIdCache.get(name);
    if (cached) return cached;

    const promise = (async () => {
      const status = await this.prisma.answerStatus.findFirst({
        where: { name },
      });
      if (!status) {
        throw new Error(
          `Critical Error: Status "${name}" not found in database. Did you run the seed?`,
        );
      }
      return status.id;
    })();

    this.statusIdCache.set(name, promise);
    promise.catch(() => this.statusIdCache.delete(name));
    return promise;
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

  async getAnswerForParticipantAndQuestion(
    participantId: number,
    questionId: number,
  ): Promise<{ id: number } | null> {
    return this.prisma.answer.findUnique({
      where: {
        gameParticipantId_questionId: {
          gameParticipantId: participantId,
          questionId: questionId,
        },
      },
      select: { id: true },
    });
  }

  async saveAnswer(
    participantId: number,
    questionId: number,
    text: string,
    submittedAt: Date,
    lateBySeconds?: number,
  ): Promise<AnswerDomain> {
    const unsetStatusId = await this.getStatusIdOrThrow(AnswerStatus.UNSET);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.answer.findUnique({
        where: {
          gameParticipantId_questionId: {
            gameParticipantId: participantId,
            questionId: questionId,
          },
        },
        select: { id: true, statusId: true },
      });

      if (existing) {
        const isUnjudged = existing.statusId === unsetStatusId;
        const updated = await tx.answer.update({
          where: { id: existing.id },
          data: {
            answerText: text,
            submittedAt: submittedAt,
            lateBySeconds: lateBySeconds,
            ...(isUnjudged ? { statusId: unsetStatusId } : {}),
          },
          include: {
            participant: { include: { team: true } },
            status: true,
          },
        });
        return AnswerMapper.toDomain(updated);
      }

      const created = await tx.answer.create({
        data: {
          gameParticipantId: participantId,
          questionId: questionId,
          answerText: text,
          submittedAt: submittedAt,
          statusId: unsetStatusId,
          lateBySeconds: lateBySeconds,
        },
        include: {
          participant: { include: { team: true } },
          status: true,
        },
      });
      return AnswerMapper.toDomain(created);
    });
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

  async getAnswerByIdForGame(
    answerId: number,
    gameId: number,
  ): Promise<AnswerDomain> {
    const answer = await this.prisma.answer.findFirst({
      where: {
        id: answerId,
        participant: { gameId },
      },
      include: {
        participant: { include: { team: true } },
        status: true,
      },
    });
    if (!answer) {
      throw new Error('Answer not found for this game');
    }
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
    if (!question) return null;

    const orderedIds = await this.getOrderedQuestionIds(gameId);
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      globalQuestionNumber: orderedIds.indexOf(question.id) + 1,
      totalQuestions: orderedIds.length,
      questionDeadline: question.questionDeadline?.getTime(),
    };
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
      // questionNumber is only unique per round, so sorting by it alone
      // interleaves rounds; order by round first, then question within it.
      orderBy: [
        { question: { round: { roundNumber: 'asc' } } },
        { question: { questionNumber: 'asc' } },
      ],
    });

    return answers.map((a) => AnswerMapper.toDomain(a));
  }

  async getGameExportParticipants(gameId: number): Promise<GameExportParticipant[]> {
    const rows = await this.prisma.gameParticipant.findMany({
      where: { gameId },
      include: { team: true, category: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({
      participantId: r.id,
      teamName: r.team.name,
      teamCode: r.team.teamCode,
      categoryId: r.categoryId,
      categoryName: r.category.name,
    }));
  }

  async getGameExportQuestionColumns(
    gameId: number,
  ): Promise<GameExportQuestionCol[]> {
    const rounds = await this.prisma.round.findMany({
      where: { gameId },
      orderBy: { roundNumber: 'asc' },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' },
          select: { id: true },
        },
      },
    });
    const cols: GameExportQuestionCol[] = [];
    let globalIndex = 0;
    for (const round of rounds) {
      for (const q of round.questions) {
        globalIndex++;
        cols.push({
          questionId: q.id,
          roundNumber: round.roundNumber,
          globalIndex,
        });
      }
    }
    return cols;
  }
}

export interface GameExportParticipant {
  participantId: number;
  teamName: string;
  teamCode: string;
  categoryId: number;
  categoryName: string;
}

export interface GameExportQuestionCol {
  questionId: number;
  roundNumber: number;
  globalIndex: number;
}
