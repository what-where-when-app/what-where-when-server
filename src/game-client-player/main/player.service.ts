import { Injectable, NotFoundException } from '@nestjs/common';
import { PlayerGameRepository } from '../../repository/player.game.repository';
import { PrismaService } from '../../repository/prisma/prisma.service';
import { GameEngineService } from '../../game-engine/main/service/game-engine.service';

@Injectable()
export class PlayerService {
  constructor(
    private readonly playerGameRepository: PlayerGameRepository,
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  async checkGameByCode(passcode: number) {
    const game =
      await this.playerGameRepository.findGameByPasscodeWithTeams(passcode);

    if (!game) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Game not found',
      });
    }

    return game;
  }

  async getLeaderboardForGame(gameId: number) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true },
    });
    if (!game) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Game not found',
      });
    }
    return this.gameEngine.getLeaderboard(gameId);
  }
}
