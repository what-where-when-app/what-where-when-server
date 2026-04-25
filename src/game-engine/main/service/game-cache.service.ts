import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { GameId } from '../../../repository/contracts/common.dto';
import {
  GamePhase,
  GameStatus,
  QuestionData,
} from '../../../repository/contracts/game-engine.dto';
import { GameRepository } from '../../../repository/game.repository';
import { REDIS_CLIENT } from '../../../redis/redis.constants';

enum GameCacheField {
  Phase = 'phase',
  Status = 'status',
  ActiveQuestionData = 'activeQuestionData',
  PhaseDeadlineTs = 'phaseDeadlineTs',
  PausedSeconds = 'pausedSeconds',
}

enum QuestionCacheField {
  DeadlineTs = 'deadlineTs',
}

@Injectable()
export class GameCacheService {
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

  constructor(
    private readonly gameRepository: GameRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private gameKey(gameId: GameId, field: GameCacheField) {
    return `game:${gameId}:${field}`;
  }

  private questionKey(questionId: number, field: QuestionCacheField) {
    return `question:${questionId}:${field}`;
  }

  private parseIntOrUndefined(raw: string | null): number | undefined {
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  private serializeQuestionData(data: QuestionData): string {
    return JSON.stringify(data);
  }

  private deserializeQuestionData(raw: string): QuestionData | undefined {
    try {
      return JSON.parse(raw) as QuestionData;
    } catch {
      return undefined;
    }
  }

  public async setQuestionDeadline(
    questionId: number,
    timestamp: number,
  ): Promise<void> {
    const key = this.questionKey(questionId, QuestionCacheField.DeadlineTs);
    const ttlMs = Math.max(5 * 60_000, timestamp - Date.now() + 5 * 60_000);
    await this.redis.set(key, String(timestamp), 'PX', ttlMs);
  }

  public async getQuestionDeadline(
    questionId: number,
  ): Promise<number | undefined> {
    const key = this.questionKey(questionId, QuestionCacheField.DeadlineTs);
    const cached = this.parseIntOrUndefined(await this.redis.get(key));
    if (cached !== undefined) return cached;

    const questionDeadline = await this.gameRepository.getQuestionDeadline(
      questionId,
    );
    if (questionDeadline !== undefined) {
      await this.setQuestionDeadline(questionId, questionDeadline);
    }
    return questionDeadline ?? undefined;
  }

  public async getPhaseEnd(gameId: GameId): Promise<number | undefined> {
    return this.parseIntOrUndefined(
      await this.redis.get(this.gameKey(gameId, GameCacheField.PhaseDeadlineTs)),
    );
  }

  public async setPhaseEnd(gameId: GameId, timestamp: number): Promise<void> {
    await this.redis.set(
      this.gameKey(gameId, GameCacheField.PhaseDeadlineTs),
      String(timestamp),
    );
  }

  public async clearPhaseEnd(gameId: GameId): Promise<void> {
    await this.redis.del(this.gameKey(gameId, GameCacheField.PhaseDeadlineTs));
  }

  public async getPausedSeconds(gameId: GameId): Promise<number | undefined> {
    return this.parseIntOrUndefined(
      await this.redis.get(this.gameKey(gameId, GameCacheField.PausedSeconds)),
    );
  }

  public async setPausedSeconds(
    gameId: GameId,
    seconds: number,
  ): Promise<void> {
    await this.redis.set(
      this.gameKey(gameId, GameCacheField.PausedSeconds),
      String(seconds),
    );
  }

  public async clearPausedSeconds(gameId: GameId): Promise<void> {
    await this.redis.del(this.gameKey(gameId, GameCacheField.PausedSeconds));
  }

  public async getPhase(gameId: GameId): Promise<GamePhase> {
    const raw = await this.redis.get(this.gameKey(gameId, GameCacheField.Phase));
    if (!raw) return GamePhase.IDLE;
    return (raw as GamePhase) ?? GamePhase.IDLE;
  }

  public async setPhase(gameId: GameId, phase: GamePhase): Promise<void> {
    await this.redis.set(this.gameKey(gameId, GameCacheField.Phase), phase);
  }

  public async getStatus(gameId: GameId): Promise<GameStatus | undefined> {
    const cached = await this.redis.get(this.gameKey(gameId, GameCacheField.Status));
    if (cached) return cached as GameStatus;

    const game = await this.gameRepository.findById(gameId);
    if (game) {
      const status = game.status as GameStatus;
      await this.redis.set(this.gameKey(gameId, GameCacheField.Status), status);
      return status;
    }
    return undefined;
  }

  public async setStatus(gameId: GameId, status: GameStatus): Promise<void> {
    await this.redis.set(this.gameKey(gameId, GameCacheField.Status), status);
  }

  public async getActiveQuestionData(
    gameId: GameId,
  ): Promise<QuestionData | undefined> {
    const key = this.gameKey(gameId, GameCacheField.ActiveQuestionData);
    const cached = await this.redis.get(key);
    if (cached) {
      const parsed = this.deserializeQuestionData(cached);
      if (parsed) return parsed;
    }

    const dbQuestionData = await this.gameRepository.findActiveQuestionData(
      gameId,
    );
    if (dbQuestionData) {
      await this.redis.set(key, this.serializeQuestionData(dbQuestionData));
      return dbQuestionData;
    }
    return undefined;
  }

  public async setActiveQuestionData(
    gameId: GameId,
    questionData: QuestionData,
  ): Promise<void> {
    await this.redis.set(
      this.gameKey(gameId, GameCacheField.ActiveQuestionData),
      this.serializeQuestionData(questionData),
    );
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
