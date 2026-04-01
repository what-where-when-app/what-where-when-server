import { BadRequestException } from '@nestjs/common';
import type {
  FeedbackChips,
  FeedbackScreen,
  FeedbackSection,
} from './player-feedback.dto';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseNameMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function parseChips(raw: unknown): FeedbackChips[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedbackChips[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    if (typeof c.key !== 'string' || c.key.length === 0) continue;
    out.push({ key: c.key, name: parseNameMap(c.name) });
  }
  return out;
}

export function parseFeedbackScreenJson(raw: unknown): FeedbackScreen {
  if (!isRecord(raw)) {
    throw new BadRequestException({ message: 'Invalid feedback form root' });
  }
  const sectionsRaw = raw.sections;
  if (!Array.isArray(sectionsRaw)) {
    throw new BadRequestException({ message: 'Invalid feedback form: sections' });
  }
  const sections: FeedbackSection[] = [];
  for (const s of sectionsRaw) {
    if (!isRecord(s)) continue;
    if (typeof s.key !== 'string' || s.key.length === 0) continue;
    if (typeof s.title !== 'string') continue;
    const chips = parseChips(s.chips);
    sections.push({ key: s.key, title: s.title, chips });
  }
  if (sections.length === 0) {
    throw new BadRequestException({ message: 'Invalid feedback form: no sections' });
  }
  return { sections };
}
