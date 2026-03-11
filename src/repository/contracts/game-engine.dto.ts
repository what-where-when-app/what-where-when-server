export enum GamePhase {
  IDLE = 'IDLE',
  PREPARATION = 'PREPARATION',
  THINKING = 'THINKING',
  ANSWERING = 'ANSWERING',
}

export enum AnswerStatus {
  UNSET = 'UNSET',
  CORRECT = 'CORRECT',
  INCORRECT = 'INCORRECT',
  DISPUTABLE = 'DISPUTABLE'
}

export enum GameStatus {
  DRAFT = 'DRAFT',
  LIVE = 'LIVE',
  FINISHED = 'FINISHED',
}

export enum DisputeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  RESOLVED = 'RESOLVED'
}

export interface JoinGameDto {
  gameId: number;
  teamId: number;
}

export interface StartQuestionDto {
  gameId: number;
  questionId: number;
}

export interface SubmitAnswerDto {
  gameId: number;
  participantId: number;
  answer: string;
  questionId: number;
  submittedAt: string;
}

export interface GetAnswersDto {
  gameId: number;
  questionId: number;
}

export interface JudgeAnswerDto {
  gameId: number;
  answerId: number;
  verdict: string;
}

export interface DisputeDto {
  gameId: number;
  answerId: number;
  comment?: string;
}

export interface AdjustTimeDto {
  gameId: number;
  delta: number;
}

export interface GameState {
  phase: GamePhase;
  seconds: number;
  isPaused: boolean;
  activeQuestionId?: number,
  activeQuestionNumber?: number,
  status?: GameStatus;
}

export interface QuestionData {
  questionId: number;
  questionNumber: number;
  questionDeadline?: number;
}

export interface ParticipantDomain {
  id: number;
  categoryId: number;
  categoryName: string;
  teamId: number;
  gameId: number;
  socketId: string | null;
  isConnected: boolean;
  teamName: string;
}

export interface AnswerDomain {
  id: number;
  questionId: number;
  questionNumber?: number;
  participantId: number;
  teamName: string;
  answerText: string;
  status: string;
  submittedAt: string;
  lateBySeconds?: number;
}

export interface QuestionSettings {
  timeToThink: number;
  timeToAnswer: number;
  questionNumber: number;
  gameId: number;
}

export interface LeaderboardEntry {
  participantId: number;
  teamName: string;
  categoryId: number;
  categoryName?: string | null;
  score: number;
  rating: number;
}