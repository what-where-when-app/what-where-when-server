import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PrismaModule } from '../../repository/prisma/prisma.module';
import { PlayerService } from './player.service';
import { PlayerGameRepository } from '../../repository/player.game.repository';
import { GameEngineModule } from '../../game-engine/game-engine.module';

@Module({
  imports: [PrismaModule, GameEngineModule],
  controllers: [PlayerController],
  providers: [PlayerService, PlayerGameRepository],
})
export class PlayerModule {}
