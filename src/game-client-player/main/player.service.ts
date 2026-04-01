import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PlayerGameRepository } from '../../repository/player.game.repository';
import { PrismaService } from '../../repository/prisma/prisma.service';
import { GameEngineService } from '../../game-engine/main/service/game-engine.service';
import type { FeedbackScreen, SubmitPlayerFeedbackDto } from './player-feedback.dto';
import { parseFeedbackScreenJson } from './player-feedback-form.parse';
import { parseSubmitPlayerFeedbackBody } from './player-feedback-payload.parse';

const FEEDBACK_PAYLOAD_MAX_BYTES = 65536;

/** JSON next to compiled `player.service.js`, or Nest asset path when JS lived under `dist/src/...`. */
function resolveFeedbackFormJsonPath(): string {
  const besideService = join(__dirname, 'player-feedback-form.default.json');
  if (existsSync(besideService)) {
    return besideService;
  }
  const fromSrcLayout = join(
    __dirname,
    '..',
    '..',
    '..',
    'game-client-player',
    'main',
    'player-feedback-form.default.json',
  );
  if (existsSync(fromSrcLayout)) {
    return fromSrcLayout;
  }
  return besideService;
}

@Injectable()
export class PlayerService {
  private feedbackFormParsed: FeedbackScreen | null = null;

  constructor(
    private readonly playerGameRepository: PlayerGameRepository,
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  getPlayerFeedbackForm(): FeedbackScreen {
    if (this.feedbackFormParsed !== null) {
      return this.feedbackFormParsed;
    }
    const path = resolveFeedbackFormJsonPath();
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    this.feedbackFormParsed = parseFeedbackScreenJson(raw);
    return this.feedbackFormParsed;
  }

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

  async submitAppFeedback(body: SubmitPlayerFeedbackDto) {
    const form = this.getPlayerFeedbackForm();
    const dto = parseSubmitPlayerFeedbackBody(body, form);
    const json = JSON.stringify(dto.payload);
    if (Buffer.byteLength(json, 'utf8') > FEEDBACK_PAYLOAD_MAX_BYTES) {
      throw new BadRequestException({ message: 'Payload too large' });
    }

    const participant =
      await this.playerGameRepository.findParticipantInGame(
        dto.participantId,
        dto.gameId,
      );
    if (!participant) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Participant not found for this game',
      });
    }

    await this.prisma.playerAppFeedback.create({
      data: {
        gameId: dto.gameId,
        participantId: dto.participantId,
        payload: dto.payload as unknown as Prisma.InputJsonValue,
      },
    });

    return { ok: true as const };
  }
}
