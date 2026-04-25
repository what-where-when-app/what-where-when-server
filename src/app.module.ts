import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { RedisModule } from './redis/redis.module';
import { PrismaModule } from './repository/prisma/prisma.module';
import { HostModule } from './game-client-admin/main/host.module';
import { GameEngineModule } from './game-engine/game-engine.module';
import { PlayerModule } from './game-client-player/main/player.module';

@Module({
  imports: [
    AppConfigModule,
    RedisModule,
    PrismaModule,
    HostModule,
    GameEngineModule,
    PlayerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
