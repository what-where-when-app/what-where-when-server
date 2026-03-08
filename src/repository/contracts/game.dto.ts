import { Prisma } from '@prisma/client';
import type { GameId, ISODateTime } from './common.dto';
import { GameStatus } from './game-engine.dto';

export const gameDetailsInclude = Prisma.validator<Prisma.GameInclude>()({
  rounds: {
    orderBy: { roundNumber: 'asc' },
    include: {
      questions: { orderBy: { questionNumber: 'asc' } },
    },
  },
  categoryLinks: { include: { category: true } },
  participants: { include: { team: true, category: true } },
});


export interface GameSettings {
  time_to_think_sec: number;
  time_to_answer_sec: number;
  time_to_dispute_end_min: number;

  show_leaderboard: boolean;
  show_questions: boolean;
  show_answers: boolean;
  can_appeal: boolean;
}

export interface GameCategory {
  id?: number;
  name: string;
  description?: string;
}

export interface GameTeam {
  id?: number;
  name: string;
  team_code: string;
  manager_id: number;
  category_id: number | null;
  created_at?: ISODateTime;
}

export interface GameQuestion {
  id?: number;
  round_id?: number;
  question_number: number;
  text: string;
  answer: string;
  time_to_think_sec: number;
  time_to_answer_sec: number;
}

export interface GameRound {
  id?: number;
  round_number: number;
  name?: string;
  questions: GameQuestion[];
}

export interface HostGameDetails {
  id: GameId;
  title: string;
  date_of_event: string;
  status: GameStatus;
  passcode: string;

  settings: GameSettings;

  // Optional for now (may be removed from admin UI later)
  categories: GameCategory[];
  teams: GameTeam[];

  rounds: GameRound[];

  updated_at: ISODateTime;
  version: number;
}

export interface HostGameCard {
  id: GameId;
  title: string;
  subtitle: string;
}