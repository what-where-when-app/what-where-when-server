import { Injectable, Logger } from '@nestjs/common';
import { GameId } from '../../../repository/contracts/common.dto';
import {
  AnswerDomain,
  GamePhase,
  GameState,
  GameStatus,
  ParticipantDomain,
  SubmitAnswerDto,
} from '../../../repository/contracts/game-engine.dto';
import { GameRepository } from '../../../repository/game.repository';
import { GameCacheService } from './game-cache.service';

@Injectable()
export class GameEngineService {
  private readonly logger = new Logger(GameEngineService.name);

  constructor(
    private readonly gameRepository: GameRepository,
    private readonly cache: GameCacheService,
  ) {}

  async finishGame(gameId: GameId): Promise<GameStatus> {
    this.cleanupTimer(gameId);

    const setStatusTo = GameStatus.FINISHED;

    try {
      await this.gameRepository.updateStatus(gameId, setStatusTo);
      await this.cache.setStatus(gameId, setStatusTo);

      this.logger.log(`Game ${gameId} finalized and set to FINISHED`);
      return setStatusTo;
    } catch (error) {
      this.logger.error(`Failed to finish game ${gameId}: ${error.message}`);
      throw error;
    }
  }

  async raiseDispute(gameId: number, answerId: number, comment: string) {
    const settings = await this.gameRepository.getGameSettings(gameId);

    if (!settings) {
      throw new Error('Game not found');
    }

    if (!settings.can_appeal) {
      throw new Error('Appeals are disabled for this game');
    }

    await this.gameRepository.createDispute(answerId, comment);

    const [updatedAnswer, leaderboard] = await Promise.all([
      this.gameRepository.getAnswerById(answerId),
      this.gameRepository.getLeaderboard(gameId),
    ]);

    return { updatedAnswer, leaderboard };
  }

  async judgeAnswer(
    gameId: number,
    answerId: number,
    verdict: string,
    adminId: number,
  ) {
    await this.gameRepository.judgeAnswer(answerId, verdict, adminId);

    const [updatedAnswer, leaderboard] = await Promise.all([
      this.gameRepository.getAnswerById(answerId),
      this.gameRepository.getLeaderboard(gameId),
    ]);

    return { updatedAnswer, leaderboard };
  }

  async startNextQuestion(
    gameId: GameId,
    onTick: (
      gameId: number,
      sec: number,
      phase: GamePhase,
      qId: number | null,
    ) => void,
  ) {
    const currentQId = await this.cache.getActiveQuestionId(gameId);
    const orderedIds = await this.gameRepository.getOrderedQuestionIds(gameId);

    if (orderedIds.length === 0) {
      this.logger.warn(`Game ${gameId} has no questions configured.`);
      return null;
    }

    const currentIndex = currentQId ? orderedIds.indexOf(currentQId) : -1;

    const nextQuestionId = orderedIds[currentIndex + 1];

    if (!nextQuestionId) {
      this.logger.log(
        `No more questions for game ${gameId}. Marking as finished?`,
      );
      return null;
    }

    await this.startQuestionCycle(gameId, nextQuestionId, onTick, () => {});
    return nextQuestionId;
  }

  async startGame(gameId: GameId): Promise<GameStatus> {
    const currentStatus = await this.cache.getStatus(gameId);
    if (currentStatus === GameStatus.LIVE) {
      this.logger.warn(`Game ${gameId} is already LIVE. Skipping update.`);
      return GameStatus.LIVE;
    }
    if (currentStatus === GameStatus.FINISHED) {
      this.logger.error(`Attempted to start a FINISHED game: ${gameId}`);
      throw new Error('Cannot start a game that is already finished');
    }

    const setStatusTo = GameStatus.LIVE;

    try {
      await this.gameRepository.updateStatus(gameId, setStatusTo);
      await this.cache.setStatus(gameId, setStatusTo);

      this.logger.log(`Game ${gameId} successfully started by host`);
      return setStatusTo;
    } catch (error) {
      this.logger.error(`Failed to start game ${gameId}: ${error.message}`);
      throw error;
    }
  }

  async validateHost(gameId: GameId, userId: number): Promise<boolean> {
    const game = await this.gameRepository.findById(gameId);
    return game?.hostId === userId;
  }

  public async getGameConfigAndJoinGame(
    gameId: GameId,
    teamId: number,
    socketId: string,
  ) {
    const status = await this.cache.getStatus(gameId);
    if (status === GameStatus.FINISHED) {
      throw new Error('Cannot join: game is already finished');
    }

    const participant = await this.gameRepository.teamJoinGame(
      gameId,
      teamId,
      socketId,
    );

    const [state, participants] = await Promise.all([
      this.getGameState(participant.gameId),
      this.gameRepository.getParticipantsByGame(participant.gameId),
    ]);

    return {
      state,
      participantId: participant.id,
      participants,
    };
  }

  public async adminSyncGame(gameId: GameId): Promise<{
    state: GameState;
    answers: AnswerDomain[];
    participants: ParticipantDomain[];
  }> {
    const [answers, state, participants] = await Promise.all([
      this.gameRepository.getAnswersByGame(gameId),
      this.getGameState(gameId),
      this.gameRepository.getParticipantsByGame(gameId),
    ]);
    return {
      state,
      answers,
      participants,
    };
  }

  public async getGameState(gameId: GameId): Promise<GameState> {
    const [status, phase, seconds, activeQuestionId, isPaused] =
      await Promise.all([
        this.cache.getStatus(gameId),
        this.getPhase(gameId),
        this.cache.getRemainingSeconds(gameId),
        this.cache.getActiveQuestionId(gameId),
        this.isPaused(gameId),
      ]);

    return {
      phase: phase,
      seconds: seconds ?? 0,
      activeQuestionId: activeQuestionId,
      isPaused: isPaused,
      status: status,
    };
  }

  async getPhase(gameId: number): Promise<GamePhase> {
    return (await this.cache.getPhase(gameId)) || GamePhase.IDLE;
  }

  async startQuestionCycle(
    gameId: GameId,
    questionId: number,
    onTick: (gameId: GameId, sec: number, phase: GamePhase, qId: number) => void,
    onPhaseChange: (phase: GamePhase) => void,
  ) {
    const status = await this.cache.getStatus(gameId);
    if (status !== GameStatus.LIVE) {
      throw new Error(`Cannot start question: game is in ${status} status`);
    }

    const questionSettings =
      await this.gameRepository.getQuestionSettings(questionId);
    if (questionSettings?.gameId !== gameId) {
      throw new Error('Question not found or does not belong to this game');
    }

    this.cleanupTimer(gameId);

    try {
      await this.gameRepository.activateQuestion(gameId, questionId);
      await this.cache.setActiveQuestionId(gameId, questionId);

      this.cache.setCallbacks(gameId, onTick, onPhaseChange);

      await this.transitionToPhase(
        gameId,
        GamePhase.THINKING,
        questionSettings.timeToThink,
      );

      this.logger.log(`Started question ${questionId} for game ${gameId}`);
    } catch (e) {
      this.logger.error(
        `Error starting cycle for game ${gameId}: ${e.message}`,
      );
      throw e;
    }
  }

  async processAnswer(data: SubmitAnswerDto): Promise<AnswerDomain | null> {
    const status = await this.cache.getStatus(data.gameId);

    if (status !== GameStatus.LIVE) {
      this.logger.warn(`Answer rejected: game ${data.gameId} is ${status}`);
      return null;
    }

    // TODO: review logic
    const [phase, activeQId] = await Promise.all([
      this.getPhase(data.gameId),
      this.cache.getActiveQuestionId(data.gameId),
    ]);

    const isLate = phase === GamePhase.IDLE || activeQId !== data.questionId;

    if (isLate) {
      this.logger.log(
        `Late submission for game ${data.gameId}. Question: ${data.questionId}, Phase: ${phase}, ActiveQ: ${activeQId}`,
      );
    }

    const savedAnswer = await this.gameRepository.saveAnswer(
      data.participantId,
      data.questionId,
      data.answer,
    );
    return {
      ...savedAnswer,
      isLate,
    };
  }

  async pauseTimer(gameId: GameId) {
    this.stopTimer(gameId);
    await this.notifyTick(gameId);
  }

  async resumeTimer(gameId: GameId) {
    if (await this.isPaused(gameId)) {
      await this.startInterval(gameId);
    }
  }

  private async isPaused(gameId: GameId) {
    return (
      this.cache.getTimer(gameId) === undefined &&
      (await this.getPhase(gameId)) !== GamePhase.IDLE
    );
  }

  async adjustTime(gameId: GameId, delta: number) {
    if ((await this.getPhase(gameId)) === GamePhase.IDLE) return;

    const current = (await this.cache.getRemainingSeconds(gameId)) ?? 0;

    let newVal = current + delta;

    if (newVal <= 0) {
      newVal = 0;
      await this.cache.setRemainingSeconds(gameId, newVal);
      await this.notifyTick(gameId);
      await this.handlePhaseCompletion(gameId);
    } else {
      await this.cache.setRemainingSeconds(gameId, newVal);
      await this.notifyTick(gameId);
    }
  }

  private async transitionToPhase(
    gameId: GameId,
    phase: GamePhase,
    seconds: number,
  ) {
    await this.cache.setPhase(gameId, phase);
    await this.cache.setRemainingSeconds(gameId, seconds);

    await this.notifyTick(gameId);
    await this.startInterval(gameId);
  }

  private async startInterval(gameId: GameId) {
    if (this.cache.getTimer(gameId) !== undefined) return;

    const interval = setInterval(async () => {
      let current = (await this.cache.getRemainingSeconds(gameId)) || 0;

      if (current > 0) {
        current--;
        await this.cache.setRemainingSeconds(gameId, current);
        await this.notifyTick(gameId);
      }

      if (current <= 0) {
        await this.handlePhaseCompletion(gameId);
      }
    }, 1000);

    this.cache.setTimer(gameId, interval);
  }

  private async handlePhaseCompletion(gameId: GameId) {
    this.stopTimer(gameId);
    const currentPhase = await this.getPhase(gameId);

    if (currentPhase === GamePhase.THINKING) {
      const questionId = await this.cache.getActiveQuestionId(gameId);
      const questionSettings = await this.gameRepository.getQuestionSettings(
        questionId!,
      );

      await this.transitionToPhase(
        gameId,
        GamePhase.ANSWERING,
        questionSettings?.timeToAnswer ?? 10,
      );
    } else if (currentPhase === GamePhase.ANSWERING) {
      await this.cache.setPhase(gameId, GamePhase.IDLE);
      await this.cache.setRemainingSeconds(gameId, 0);

      const onPhaseChange = this.cache.getPhaseChangeCallback(gameId);
      if (onPhaseChange) onPhaseChange(GamePhase.IDLE);

      this.cleanupTimer(gameId);
    }
  }

  private async notifyTick(gameId: GameId) {
    const onTick = this.cache.getTickCallback(gameId);
    const seconds = (await this.cache.getRemainingSeconds(gameId)) ?? 0;
    const phase = await this.getPhase(gameId);
    const qId = (await this.cache.getActiveQuestionId(gameId)) ?? null;

    if (onTick) {
      onTick(gameId, seconds, phase, qId);
    }
  }

  private stopTimer(gameId: GameId) {
    const timer = this.cache.getTimer(gameId);
    if (timer) {
      clearInterval(timer);
      this.cache.clearTimer(gameId);
    }
  }

  private cleanupTimer(gameId: GameId) {
    this.stopTimer(gameId);
    this.cache.removeCallbacks(gameId);
  }
}
