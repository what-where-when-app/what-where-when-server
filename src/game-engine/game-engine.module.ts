import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../repository/prisma/prisma.module';
import { GameRepository } from '../repository/game.repository';
import { GameEngineService } from './main/service/game-engine.service';
import { GameEngineGateway } from './main/controller/game-engine.gateway';
import { WsJwtGuard } from './main/guards/ws-jwt.guard';
import { GameCacheService } from './main/service/game-cache.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [
    GameEngineService,
    GameEngineGateway,
    GameRepository,
    WsJwtGuard,
    GameCacheService,
  ],
})
export class GameEngineModule {}
