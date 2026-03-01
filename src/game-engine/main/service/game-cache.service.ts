import { Injectable } from '@nestjs/common';
import { GameId } from '../../../repository/contracts/common.dto';
import {
  GamePhase,
  GameStatus,
} from '../../../repository/contracts/game-engine.dto';
import { GameRepository } from '../../../repository/game.repository';

@Injectable()
export class GameCacheService {
  private readonly phases: Map<GameId, GamePhase> = new Map();
  private readonly statuses: Map<GameId, GameStatus> = new Map();
  private readonly remainingSeconds: Map<GameId, number> = new Map();
  private readonly activeQuestionIds: Map<GameId, number> = new Map();

  private readonly activeTimers: Map<GameId, NodeJS.Timeout> = new Map();
  private readonly tickCallbacks: Map<
    GameId,
    (gameId: GameId, sec: number, phase: GamePhase, qId: number | null) => void
  > = new Map();
  private readonly phaseChangeCallbacks: Map<
    GameId,
    (phase: GamePhase) => void
  > = new Map();

  constructor(
    private readonly gameRepository: GameRepository,
  ) {}

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

  public async getRemainingSeconds(gameId: GameId): Promise<number> {
    return this.remainingSeconds.get(gameId) ?? 0;
  }

  public async setRemainingSeconds(
    gameId: GameId,
    seconds: number,
  ): Promise<void> {
    this.remainingSeconds.set(gameId, seconds);
  }

  public async getActiveQuestionId(
    gameId: GameId,
  ): Promise<number | undefined> {
    let qId = this.activeQuestionIds.get(gameId);

    if (!qId) {
      const dbQId = await this.gameRepository.findActiveQuestionId(gameId);
      if (dbQId) {
        qId = dbQId;
        this.activeQuestionIds.set(gameId, qId);
      }
    }
    return qId;
  }

  public async setActiveQuestionId(
    gameId: GameId,
    questionId: number,
  ): Promise<void> {
    this.activeQuestionIds.set(gameId, questionId);
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
    onTick: (gameId: number, sec: number, phase: GamePhase, qId) => void,
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
