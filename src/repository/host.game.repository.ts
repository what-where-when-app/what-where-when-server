import {
  HostGamesListResponse,
  SaveGameRequest,
} from '../game-client-admin/main/controller/host.controller';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import {
  gameDetailsInclude,
  HostGameCard,
  HostGameDetails,
} from './contracts/game.dto';
import { mapHostGameCard, mapHostGameDetails } from './mappers/host-game.mapper';
import { type Game, Prisma } from '@prisma/client';
import { GameStatus } from './contracts/game-engine.dto';
import {
  gameVersion,
  generate4DigitPasscode,
  parseDateOfEvent,
} from './utils/game.util';

const GAME_CODE_LOCK = 424242;

@Injectable()
export class HostGameRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listHostGames(params: {
    hostId: number;
    limit: number;
    offset: number;
  }): Promise<HostGamesListResponse> {
    const where: Prisma.GameWhereInput = { hostId: params.hostId };

    const total = await this.prisma.game.count({ where });
    const games = await this.prisma.game.findMany({
      where,
      orderBy: { modifiedAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      select: { id: true, name: true, date: true },
    });

    const items: HostGameCard[] = games.map(mapHostGameCard);

    return {
      items,
      pagination: { limit: params.limit, offset: params.offset, total },
    };
  }

  async createGameWithAutoPasscode(params: {
    hostId: number;
    name: string;
    date: Date;
    status: string;
  }): Promise<Game> {
    return this.prisma.$transaction(async (tx) => {
      const passcode = await this.allocateAvailablePasscode(tx);
      const game = await tx.game.create({
        data: {
          hostId: params.hostId,
          name: params.name,
          date: params.date,
          passcode,
          status: params.status,
          modifiedAt: new Date(),
        },
      });

      const ownedCategories = await tx.category.findMany({
        where: { userId: params.hostId },
      });
      for (const category of ownedCategories) {
        await tx.categoryGameRelation.upsert({
          where: {
            categoryId_gameId: { categoryId: category.id, gameId: game.id },
          },
          create: { categoryId: category.id, gameId: game.id },
          update: {},
        });
      }

      const ownedTeams = await tx.team.findMany({
        where: { managerId: params.hostId },
      });
      for (const team of ownedTeams) {
        await tx.gameParticipant.create({
          data: {
            gameId: game.id,
            teamId: team.id,
            categoryId: ownedCategories[0].id,
            isAvailable: true,
          },
        });
      }

      return game;
    });
  }

  private async allocateAvailablePasscode(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${GAME_CODE_LOCK})`;

    const activeStatuses = [GameStatus.DRAFT, GameStatus.LIVE];

    const rows = await tx.game.findMany({
      where: { status: { in: activeStatuses } },
      select: { passcode: true },
    });

    const used = new Set<number>();
    for (const r of rows) used.add(r.passcode);

    if (used.size >= 9000) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'No passcodes available',
      });
    }

    for (let i = 0; i < 64; i++) {
      const candidate = generate4DigitPasscode();
      if (!used.has(candidate)) return candidate;
    }

    for (let candidate = 1000; candidate <= 9999; candidate++) {
      if (!used.has(candidate)) return candidate;
    }

    // Should be unreachable due to used.size check
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'No passcodes available',
    });
  }

  async getHostGameDetails(params: {
    hostId: number;
    gameId: number;
  }): Promise<HostGameDetails | null> {
    const row = await this.prisma.game.findFirst({
      where: { id: params.gameId, hostId: params.hostId },
      include: gameDetailsInclude,
    });
    return row ? mapHostGameDetails(row) : null;
  }

  async saveHostGame(params: {
    hostId: number;
    req: SaveGameRequest;
  }): Promise<HostGameDetails> {
    const { hostId, req } = params;

    const full = await this.prisma.$transaction(async (tx) => {
      if (req.game.teams.length > 0 && req.game.categories.length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'At least one category is required when adding teams',
        });
      }

      const existing = await tx.game.findFirst({
        where: { id: req.game_id, hostId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Game not found',
        });
      }

      const currentVersion = gameVersion(existing);
      if (currentVersion !== req.version) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Version conflict. Reload game and retry save.',
          details: { current_version: currentVersion },
        });
      }

      const date = parseDateOfEvent(req.game.date_of_event);

      await tx.game.update({
        where: { id: existing.id },
        data: {
          name: req.game.title,
          date,
          timeToThink: req.game.settings.time_to_think_sec,
          timeToAnswer: req.game.settings.time_to_answer_sec,
          timeToDisputeEnd: req.game.settings.time_to_dispute_end_min * 60,
          showLeaderboard: req.game.settings.show_leaderboard,
          showQuestions: req.game.settings.show_questions,
          showAnswer: req.game.settings.show_answers,
          canAppeal: req.game.settings.can_appeal,
          modifiedAt: new Date(),
        },
      });

      if (req.deleted_question_ids?.length) {
        await tx.question.deleteMany({
          where: {
            id: { in: req.deleted_question_ids },
            round: { gameId: existing.id },
          },
        });
      }

      if (req.deleted_round_ids?.length) {
        await tx.question.deleteMany({
          where: {
            roundId: { in: req.deleted_round_ids },
            round: { gameId: existing.id },
          },
        });
        await tx.round.deleteMany({
          where: { id: { in: req.deleted_round_ids }, gameId: existing.id },
        });
      }

      if (req.deleted_team_ids?.length) {
        await tx.gameParticipant.deleteMany({
          where: { gameId: existing.id, teamId: { in: req.deleted_team_ids } },
        });
      }

      if (req.deleted_category_ids?.length) {
        await tx.categoryGameRelation.deleteMany({
          where: {
            gameId: existing.id,
            categoryId: { in: req.deleted_category_ids },
          },
        });
      }

      const categoryIds: number[] = [];
      for (const c of req.game.categories) {
        let categoryId: number;
        if (c.id) {
          const owned = await tx.category.findFirst({
            where: { id: c.id, userId: hostId },
          });
          if (!owned) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: `Category not found: ${c.id}`,
            });
          }
          await tx.category.update({
            where: { id: c.id },
            data: { name: c.name, description: c.description ?? null },
          });
          categoryId = c.id;
        } else {
          const created = await tx.category.create({
            data: {
              userId: hostId,
              name: c.name,
              description: c.description ?? null,
            },
          });
          categoryId = created.id;
        }
        categoryIds.push(categoryId);

        await tx.categoryGameRelation.upsert({
          where: {
            categoryId_gameId: { categoryId, gameId: existing.id },
          },
          create: { categoryId, gameId: existing.id },
          update: {},
        });
      }

      if (req.game.teams.length > 0 && categoryIds.length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message:
            'At least one category is required before adding teams to a game',
        });
      }

      for (const t of req.game.teams) {
        let teamId: number;
        if (t.id) {
          const ownedTeam = await tx.team.findFirst({ where: { id: t.id } });
          if (!ownedTeam) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: `Team not found: ${t.id}`,
            });
          }
          const updated = await tx.team.update({
            where: { id: t.id },
            data: { name: t.name, teamCode: t.team_code, categoryId: t.category_id },
          });
          teamId = updated.id;
        } else {
          const created = await tx.team.create({
            data: { name: t.name, teamCode: t.team_code, managerId: hostId },
          });
          teamId = created.id;
        }

        if (t.category_id) {
          const already = await tx.gameParticipant.findFirst({
            where: { gameId: existing.id, teamId },
          });
          if (!already) {
            await tx.gameParticipant.create({
              data: {
                gameId: existing.id,
                teamId,
                categoryId: t.category_id,
                isAvailable: true,
              },
            });
          }
        }
      }

      for (const r of req.game.rounds) {
        let roundId: number;
        if (r.id) {
          const ownedRound = await tx.round.findFirst({
            where: { id: r.id, gameId: existing.id },
          });
          if (!ownedRound) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: `Round not found: ${r.id}`,
            });
          }
          const updated = await tx.round.update({
            where: { id: r.id },
            data: { roundNumber: r.round_number, name: r.name ?? null },
          });
          roundId = updated.id;
        } else {
          const created = await tx.round.create({
            data: {
              gameId: existing.id,
              roundNumber: r.round_number,
              name: r.name ?? null,
            },
          });
          roundId = created.id;
        }

        for (const q of r.questions) {
          if (q.id) {
            const ownedQuestion = await tx.question.findFirst({
              where: { id: q.id, round: { gameId: existing.id } },
            });
            if (!ownedQuestion) {
              throw new NotFoundException({
                code: 'NOT_FOUND',
                message: `Question not found: ${q.id}`,
              });
            }
            await tx.question.update({
              where: { id: q.id },
              data: {
                roundId,
                questionNumber: q.question_number,
                text: q.text,
                answer: q.answer,
                timeToThink: q.time_to_think_sec,
                timeToAnswer: q.time_to_answer_sec,
              },
            });
          } else {
            await tx.question.create({
              data: {
                roundId,
                questionNumber: q.question_number,
                text: q.text,
                answer: q.answer,
                timeToThink: q.time_to_think_sec,
                timeToAnswer: q.time_to_answer_sec,
                isActive: false,
              },
            });
          }
        }
      }

      const updated = await tx.game.findFirst({
        where: { id: existing.id, hostId },
        include: gameDetailsInclude,
      });

      if (!updated) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Game not found after save',
        });
      }

      return updated;
    });

    return mapHostGameDetails(full);
  }
}
