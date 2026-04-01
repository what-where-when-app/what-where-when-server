import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PlayerGameRepository } from '../../../repository/player.game.repository';
import { PrismaService } from '../../../repository/prisma/prisma.service';
import type { FeedbackScreen, SubmitPlayerFeedbackDto } from './player-feedback.dto';
import { parseFeedbackScreenJson } from './player-feedback-form.parse';
import { parseSubmitPlayerFeedbackBody } from './player-feedback-payload.parse';

const FEEDBACK_PAYLOAD_MAX_BYTES = 65536;

function resolveFeedbackFormJsonPath(): string {
  const besideService = join(__dirname, 'player-feedback-form.default.json');
  if (existsSync(besideService)) {
    return besideService;
  }
  const siblingMain = join(__dirname, '..', 'player-feedback-form.default.json');
  if (existsSync(siblingMain)) {
    return siblingMain;
  }
  const legacy = join(
    __dirname,
    '..',
    '..',
    '..',
    'game-client-player',
    'main',
    'player-feedback-form.default.json',
  );
  if (existsSync(legacy)) {
    return legacy;
  }
  const legacyFeedback = join(
    __dirname,
    '..',
    '..',
    '..',
    'game-client-player',
    'main',
    'feedback',
    'player-feedback-form.default.json',
  );
  if (existsSync(legacyFeedback)) {
    return legacyFeedback;
  }
  return besideService;
}

@Injectable()
export class PlayerAppFeedbackService {
  private feedbackFormParsed: FeedbackScreen | null = null;

  constructor(
    private readonly playerGameRepository: PlayerGameRepository,
    private readonly prisma: PrismaService,
  ) {}

  getFeedbackForm(): FeedbackScreen {
    if (this.feedbackFormParsed !== null) {
      return this.feedbackFormParsed;
    }
    const path = resolveFeedbackFormJsonPath();
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    this.feedbackFormParsed = parseFeedbackScreenJson(raw);
    return this.feedbackFormParsed;
  }

  async submitFeedback(body: SubmitPlayerFeedbackDto): Promise<{ ok: true }> {
    const form = this.getFeedbackForm();
    const dto = parseSubmitPlayerFeedbackBody(body, form);
    const json = JSON.stringify(dto.payload);
    if (Buffer.byteLength(json, 'utf8') > FEEDBACK_PAYLOAD_MAX_BYTES) {
      throw new BadRequestException({ message: 'Payload too large' });
    }

    if (dto.linkedToGame) {
      const participant = await this.playerGameRepository.findParticipantInGame(
        dto.participantId,
        dto.gameId,
      );
      if (!participant) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Participant not found for this game',
        });
      }
    }

    await this.prisma.playerAppFeedback.create({
      data: {
        gameId: dto.linkedToGame ? dto.gameId : null,
        participantId: dto.linkedToGame ? dto.participantId : null,
        payload: dto.payload as unknown as Prisma.InputJsonValue,
      },
    });

    return { ok: true };
  }
}
