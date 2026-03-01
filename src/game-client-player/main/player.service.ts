import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlayerGameRepository } from '../../repository/player.game.repository';

@Injectable()
export class PlayerService {
  constructor(private readonly playerGameRepository: PlayerGameRepository) {}

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
}
