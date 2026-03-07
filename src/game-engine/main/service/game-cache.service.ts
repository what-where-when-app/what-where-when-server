import { Injectable } from '@nestjs/common';
import { GameId } from '../../../repository/contracts/common.dto';
import {
  GamePhase,
  GameStatus,
  QuestionData,
} from '../../../repository/contracts/game-engine.dto';
import { GameRepository } from '../../../repository/game.repository';

@Injectable()
export class GameCacheService {
  private readonly phases: Map<GameId, GamePhase> = new Map();
  private readonly statuses: Map<GameId, GameStatus> = new Map();
  private readonly activeQuestionIds: Map<GameId, QuestionData> = new Map();
  private readonly phaseDeadlines = new Map<GameId, number>();
  private readonly pausedSeconds = new Map<GameId, number>();
  private readonly questionDeadlines = new Map<number, number>();

  private readonly activeTimers: Map<GameId, NodeJS.Timeout> = new Map();
  private readonly tickCallbacks: Map<
    GameId,
    (
      gameId: GameId,
      sec: number,
      phase: GamePhase,
      qData: QuestionData | null,
    ) => void
  > = new Map();
  private readonly phaseChangeCallbacks: Map<
    GameId,
    (phase: GamePhase) => void
  > = new Map();

  constructor(private readonly gameRepository: GameRepository) {}

  public async setQuestionDeadline(
    questionId: number,
    timestamp: number,
  ): Promise<void> {
    this.questionDeadlines.set(questionId, timestamp);
  }

  public async getQuestionDeadline(
    questionId: number,
  ): Promise<number | undefined> {
    let questionDeadline = this.questionDeadlines.get(questionId);
    if (!questionDeadline) {
      questionDeadline = await this.gameRepository.getQuestionDeadline(questionId);
    }
    return questionDeadline;
  }

  public async getPhaseEnd(gameId: GameId): Promise<number | undefined> {
    return this.phaseDeadlines.get(gameId);
  }

  public async setPhaseEnd(gameId: GameId, timestamp: number): Promise<void> {
    this.phaseDeadlines.set(gameId, timestamp);
  }

  public async clearPhaseEnd(gameId: GameId): Promise<void> {
    this.phaseDeadlines.delete(gameId);
  }

  public async getPausedSeconds(gameId: GameId): Promise<number | undefined> {
    return this.pausedSeconds.get(gameId);
  }

  public async setPausedSeconds(
    gameId: GameId,
    seconds: number,
  ): Promise<void> {
    this.pausedSeconds.set(gameId, seconds);
  }

  public async clearPausedSeconds(gameId: GameId): Promise<void> {
    this.pausedSeconds.delete(gameId);
  }

  public async getPhase(gameId: GameId): Promise<GamePhase> {
    return this.phases.get(gameId) || GamePhase.IDLE;
  }

  public async setPhase(gameId: GameId, phase: GamePhase): Promise<void> {
    this.phases.set(gameId, phase);
  }

  public async getStatus(gameId: GameId): Promise<GameStatus | undefined> {
    let status = this.statuses.get(gameId);

    if (!status) {
      const game = await this.gameRepository.findById(gameId);
      if (game) {
        status = game.status as GameStatus;
        this.statuses.set(gameId, status);
      }
    }
    return status;
  }

  public async setStatus(gameId: GameId, status: GameStatus): Promise<void> {
    this.statuses.set(gameId, status);
  }

  public async getActiveQuestionData(
    gameId: GameId,
  ): Promise<QuestionData | undefined> {
    let questionData = this.activeQuestionIds.get(gameId);

    if (!questionData) {
      const dbQuestionData =
        await this.gameRepository.findActiveQuestionData(gameId);
      if (dbQuestionData) {
        questionData = dbQuestionData;
        this.activeQuestionIds.set(gameId, questionData);
      }
    }
    return questionData;
  }

  public async setActiveQuestionData(
    gameId: GameId,
    questionData: QuestionData,
  ): Promise<void> {
    this.activeQuestionIds.set(gameId, questionData);
  }

  public getTimer(gameId: GameId): NodeJS.Timeout | undefined {
    return this.activeTimers.get(gameId);
  }

  public setTimer(gameId: GameId, timer: NodeJS.Timeout): void {
    this.activeTimers.set(gameId, timer);
  }

  public clearTimer(gameId: GameId): void {
    const timer = this.activeTimers.get(gameId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(gameId);
    }
  }

  public setCallbacks(
    gameId: GameId,
    onTick: (
      gameId: number,
      sec: number,
      phase: GamePhase,
      qData: QuestionData | null,
    ) => void,
    onPhaseChange: (phase: GamePhase) => void,
  ): void {
    this.tickCallbacks.set(gameId, onTick);
    this.phaseChangeCallbacks.set(gameId, onPhaseChange);
  }

  public getTickCallback(gameId: GameId) {
    return this.tickCallbacks.get(gameId);
  }

  public getPhaseChangeCallback(gameId: GameId) {
    return this.phaseChangeCallbacks.get(gameId);
  }

  public removeCallbacks(gameId: GameId): void {
    this.tickCallbacks.delete(gameId);
    this.phaseChangeCallbacks.delete(gameId);
  }
}
