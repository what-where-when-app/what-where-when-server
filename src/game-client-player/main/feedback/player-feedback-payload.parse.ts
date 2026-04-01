import { BadRequestException } from '@nestjs/common';
import type {
  FeedbackScreen,
  ParsedSubmitPlayerFeedback,
  PlayerAppFeedbackPayload,
  SubmitPlayerFeedbackDto,
} from './player-feedback.dto';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateSelectionsAgainstForm(
  selections: Record<string, string[]>,
  form: FeedbackScreen,
): void {
  const bySection = new Map(form.sections.map((s) => [s.key, s]));
  for (const sectionKey of Object.keys(selections)) {
    const section = bySection.get(sectionKey);
    if (!section) {
      throw new BadRequestException({
        code: 'INVALID_SELECTIONS',
        message: `Unknown section key: ${sectionKey}`,
      });
    }
    const allowed = new Set(section.chips.map((c) => c.key));
    const chosen = selections[sectionKey];
    if (!Array.isArray(chosen)) {
      throw new BadRequestException({
        code: 'INVALID_SELECTIONS',
        message: `selections["${sectionKey}"] must be an array of chip keys`,
      });
    }
    for (const chipKey of chosen) {
      if (typeof chipKey !== 'string' || !allowed.has(chipKey)) {
        throw new BadRequestException({
          code: 'INVALID_SELECTIONS',
          message: `Invalid chip key "${chipKey}" for section "${sectionKey}"`,
        });
      }
    }
  }
}

function isAbsent(v: unknown): boolean {
  return v === undefined || v === null;
}

/**
 * Validates and normalizes the HTTP body. Omit both `gameId` and `participantId` for
 * anonymous feedback (e.g. from the app home screen).
 */
export function parseSubmitPlayerFeedbackBody(
  body: SubmitPlayerFeedbackDto,
  form: FeedbackScreen,
): ParsedSubmitPlayerFeedback {
  if (!isRecord(body)) {
    throw new BadRequestException({ message: 'Invalid body' });
  }
  const rawGid = body.gameId;
  const rawPid = body.participantId;
  const gidAbsent = isAbsent(rawGid);
  const pidAbsent = isAbsent(rawPid);
  if (gidAbsent !== pidAbsent) {
    throw new BadRequestException({
      message: 'gameId and participantId must both be set or both omitted',
    });
  }
  const linkedToGame = !gidAbsent;
  let gameId!: number;
  let participantId!: number;
  if (linkedToGame) {
    gameId = Number(rawGid);
    participantId = Number(rawPid);
    if (!Number.isInteger(gameId) || gameId < 1) {
      throw new BadRequestException({ message: 'Invalid gameId' });
    }
    if (!Number.isInteger(participantId) || participantId < 1) {
      throw new BadRequestException({ message: 'Invalid participantId' });
    }
  }
  const payloadRaw = body.payload;
  if (!isRecord(payloadRaw)) {
    throw new BadRequestException({ message: 'Invalid payload' });
  }
  const rating = Number(payloadRaw.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new BadRequestException({ message: 'Rating must be 1–5' });
  }
  const selRaw = payloadRaw.selections;
  if (!isRecord(selRaw)) {
    throw new BadRequestException({ message: 'payload.selections must be an object' });
  }
  const selections: Record<string, string[]> = {};
  for (const [sectionKey, val] of Object.entries(selRaw)) {
    if (!Array.isArray(val)) {
      throw new BadRequestException({
        message: `payload.selections["${sectionKey}"] must be an array`,
      });
    }
    const keys: string[] = [];
    for (const item of val) {
      if (typeof item !== 'string') {
        throw new BadRequestException({ message: 'Each selection must be a string chip key' });
      }
      keys.push(item);
    }
    selections[sectionKey] = keys;
  }
  validateSelectionsAgainstForm(selections, form);

  let comment: string | undefined;
  if (payloadRaw.comment !== undefined) {
    if (typeof payloadRaw.comment !== 'string') {
      throw new BadRequestException({ message: 'comment must be a string' });
    }
    comment = payloadRaw.comment.slice(0, 4000);
  }
  let locale: string | undefined;
  if (payloadRaw.locale !== undefined) {
    if (typeof payloadRaw.locale !== 'string') {
      throw new BadRequestException({ message: 'locale must be a string' });
    }
    locale = payloadRaw.locale.slice(0, 16);
  }

  const payload: PlayerAppFeedbackPayload = {
    rating,
    selections,
    comment,
    locale,
  };
  if (linkedToGame) {
    return { linkedToGame: true, gameId, participantId, payload };
  }
  return { linkedToGame: false, payload };
}
