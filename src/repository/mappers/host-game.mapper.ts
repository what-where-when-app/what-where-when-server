import type { Category, GameParticipant, Team } from '@prisma/client';
import type {
  GameSettings,
  HostGameCard,
  HostGameDetails,
} from '../contracts/game.dto';
import { coerceGameStatus } from '../types/guards';
import {
  formatDateOfEvent,
  gameUpdatedAt,
  gameVersion,
} from '../utils/game.util';
import {
  AnswerDomain,
  AnswerStatus,
  ParticipantDomain,
} from '../contracts/game-engine.dto';


export type GameListLike = {
  id: number;
  name: string;
  date: Date;
};

export function mapHostGameCard(game: GameListLike): HostGameCard {
  return {
    id: game.id,
    title: game.name,
    subtitle: formatDateOfEvent(game.date),
  };
}

export type GameDetailsLike = {
  id: number;
  name: string;
  date: Date;
  status: string;
  passcode: number;
  timeToThink: number;
  timeToAnswer: number;
  timeToDisputeEnd: number;
  showLeaderboard: boolean;
  showQuestions: boolean;
  showAnswer: boolean;
  canAppeal: boolean;
  createdAt: Date;
  modifiedAt: Date | null;

  categoryLinks: Array<{
    category: { id: number; name: string; description: string | null };
  }>;
  participants: Array<GameParticipant & { team: Team; category: Category }>;
  rounds: Array<{
    id: number;
    roundNumber: number;
    name: string | null;
    questions: Array<{
      id: number;
      roundId: number;
      questionNumber: number;
      text: string;
      answer: string;
      timeToThink: number;
      timeToAnswer: number;
    }>;
  }>;
};

function uniqueTeams(
  participants: Array<GameParticipant & { team: Team; category: Category }>,
): Team[] {
  const byId = new Map<number, Team>();
  for (const p of participants) byId.set(p.team.id, p.team);
  return [...byId.values()];
}
export type GameSettingsLike = {
  timeToThink: number;
  timeToAnswer: number;
  timeToDisputeEnd: number;
  showLeaderboard: boolean;
  showQuestions: boolean;
  showAnswer: boolean;
  canAppeal: boolean;
};

export function mapGameSettings(game: GameSettingsLike): GameSettings {
  return {
    time_to_think_sec: game.timeToThink,
    time_to_answer_sec: game.timeToAnswer,
    time_to_dispute_end_min: Math.round(game.timeToDisputeEnd / 60),
    show_leaderboard: game.showLeaderboard,
    show_questions: game.showQuestions,
    show_answers: game.showAnswer,
    can_appeal: game.canAppeal,
  };
}

export function mapHostGameDetails(game: GameDetailsLike): HostGameDetails {
  const updatedAt = gameUpdatedAt(game);

  return {
    id: game.id,
    title: game.name,
    date_of_event: formatDateOfEvent(game.date),
    status: coerceGameStatus(game.status),
    passcode: String(game.passcode),

    settings: mapGameSettings(game),

    categories: game.categoryLinks.map((l) => ({
      id: l.category.id,
      name: l.category.name,
      description: l.category.description ?? undefined,
    })),

    teams: uniqueTeams(game.participants).map((t) => ({
      id: t.id,
      manager_id: t.managerId,
      name: t.name,
      team_code: t.teamCode,
      created_at: t.createdAt.toISOString(),
    })),

    rounds: game.rounds.map((r) => ({
      id: r.id,
      round_number: r.roundNumber,
      name: r.name ?? undefined,
      questions: r.questions.map((q) => ({
        id: q.id,
        round_id: q.roundId,
        question_number: q.questionNumber,
        text: q.text,
        answer: q.answer,
        time_to_think_sec: q.timeToThink,
        time_to_answer_sec: q.timeToAnswer,
      })),
    })),

    updated_at: updatedAt.toISOString(),
    version: gameVersion(game),
  };
}

export class PlayerMapper {
  static toParticipantDomain(
    data: GameParticipant & { team: Team },
  ): ParticipantDomain {
    return {
      id: data.id,
      gameId: data.gameId,
      teamId: data.teamId,
      isConnected: !data.isAvailable,
      socketId: data.socketId,
      teamName: data.team.name,
    };
  }
}

export class AnswerMapper {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static toDomain(raw: any): AnswerDomain {
    return {
      id: raw.id,
      questionId: raw.questionId,
      participantId: raw.gameParticipantId,
      teamName: raw.participant?.team?.name || 'Unknown Team',
      answerText: raw.answerText,
      status: raw.status?.name || AnswerStatus.UNSET,
      submittedAt: raw.submittedAt.toISOString(),
    };
  }
}
