import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CheckGameResponse } from '../game-client-player/main/player.controller';
import { GameStatus } from './contracts/game-engine.dto';

@Injectable()
export class PlayerGameRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findGameByPasscodeWithTeams(
    passcode: number,
  ): Promise<CheckGameResponse | null> {
    const game = await this.prisma.game.findFirst({
      where: {
        passcode,
        status: { not: GameStatus.FINISHED },
      },
      include: {
        participants: {
          include: {
            team: true,
          },
        },
      },
    });

    if (!game) return null;

    return {
      gameId: game.id,
      gameName: game.name,
      teams: game.participants.map((p) => ({
        teamId: p.teamId,
        name: p.team.name,
        isAvailable: p.isAvailable,
      })),
    };
  }
}
