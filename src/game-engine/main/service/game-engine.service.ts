import { Injectable, Logger } from '@nestjs/common';
import { GameId } from '../../../repository/contracts/common.dto';
import {
  AnswerDomain,
  AnswerStatus,
  GamePhase,
  GameState,
  GameStatus,
  LeaderboardEntry,
  ParticipantDomain,
  QuestionData,
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

  public async getLeaderboard(gameId: GameId): Promise<LeaderboardEntry[]> {
    const [allParticipants, allAnswers] = await Promise.all([
      this.gameRepository.getParticipantsByGame(gameId),
      this.gameRepository.getAnswersByGame(gameId),
    ]);

    const participantIdsWithAnswers = new Set(
      allAnswers.map((a) => a.participantId),
    );

    const activeParticipants = allParticipants.filter(
      (p) => participantIdsWithAnswers.has(p.id) || p.isConnected,
    );

    const totalActiveTeamsCount = activeParticipants.length;

    if (totalActiveTeamsCount === 0) return [];

    const correctAnswers = allAnswers.filter((a) => a.status === AnswerStatus.CORRECT);

    const correctCountsByQuestion = new Map<number, number>();
    correctAnswers.forEach((ans) => {
      const current = correctCountsByQuestion.get(ans.questionId) || 0;
      correctCountsByQuestion.set(ans.questionId, current + 1);
    });

    const questionWeights = new Map<number, number>();
    correctCountsByQuestion.forEach((correctCount, questionId) => {
      const weight = totalActiveTeamsCount - correctCount + 1;
      questionWeights.set(questionId, weight);
    });

    const leaderboard: LeaderboardEntry[] = activeParticipants.map((p) => {
      const teamCorrectAnswers = correctAnswers.filter(
        (a) => a.participantId === p.id,
      );

      const score = teamCorrectAnswers.length;
      const rating = teamCorrectAnswers.reduce((sum, ans) => {
        return sum + (questionWeights.get(ans.questionId) || 0);
      }, 0);

      return {
        participantId: p.id,
        teamName: p.teamName,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        score: score,
        rating: rating,
      };
    });

    return leaderboard.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.rating - a.rating;
    });
  }

  public async stopQuestion(gameId: GameId) {
    const status = await this.cache.getStatus(gameId);
    if (status !== GameStatus.LIVE) {
      this.logger.warn('Status of the game is not LIVE to stop question');
      return;
    }

    const onPhaseChange = this.cache.getPhaseChangeCallback(gameId);

    this.stopTimer(gameId);

    await this.cache.clearPausedSeconds(gameId);
    await this.cache.setPhase(gameId, GamePhase.IDLE);

    await this.notifyTick(gameId);

    if (onPhaseChange) onPhaseChange(GamePhase.IDLE);

    this.cache.removeCallbacks(gameId);

    this.logger.log(`Question manually stopped for game ${gameId}`);
  }

  public async disconnectParticipant(socketId: string) {
    await this.gameRepository.setParticipantDisconnected(socketId);
    this.logger.log(`Client disconnected: ${socketId}`);
  }

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
      this.getLeaderboard(gameId),
    ]);

    return { updatedAnswer, leaderboard };
  }

  async judgeAnswer(
    gameId: number,
    answerId: number,
    verdict: string,
    adminId: number,
  ) {
    const updatedData = await this.gameRepository.judgeAnswer(
      answerId,
      verdict,
      adminId,
    );

    const [updatedAnswer, history] = await Promise.all([
      this.gameRepository.getAnswerById(answerId),
      this.gameRepository.getParticipantAnswerHistory(updatedData.gameParticipantId)
    ]);

    return { updatedAnswer, history, socketId: updatedData.socketId};
  }

  async startNextQuestion(
    gameId: GameId,
    onTick: (
      gameId: number,
      sec: number,
      phase: GamePhase,
      qData: QuestionData | null,
    ) => void,
  ) {
    const currentQuestionData = await this.cache.getActiveQuestionData(gameId);
    const orderedIds = await this.gameRepository.getOrderedQuestionIds(gameId);

    if (orderedIds.length === 0) {
      this.logger.warn(`Game ${gameId} has no questions configured.`);
      return null;
    }

    const currentIndex = currentQuestionData?.questionId
      ? orderedIds.indexOf(currentQuestionData.questionId)
      : -1;

    const nextQuestionId = orderedIds[currentIndex + 1];

    if (!nextQuestionId) {
      this.logger.log(
        `No more questions for game ${gameId}. Marking as finished?`,
      );
      return null;
    }

    await this.prepareQuestion(gameId, nextQuestionId, onTick, () => {});
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
    leaderboard: LeaderboardEntry[]
  }> {
    const [answers, state, participants, leaderboard] = await Promise.all([
      this.gameRepository.getAnswersByGame(gameId),
      this.getGameState(gameId),
      this.gameRepository.getParticipantsByGame(gameId),
      this.getLeaderboard(gameId),
    ]);
    return {
      state,
      answers,
      participants,
      leaderboard
    };
  }

  public async getGameState(gameId: GameId): Promise<GameState> {
    const [status, phase, seconds, activeQuestionData, isPaused] =
      await Promise.all([
        this.cache.getStatus(gameId),
        this.getPhase(gameId),
        this.calculateRemainingSeconds(gameId),
        this.cache.getActiveQuestionData(gameId),
        this.isPaused(gameId),
      ]);

    return {
      phase: phase,
      seconds: seconds ?? 0,
      activeQuestionId: activeQuestionData?.questionId,
      activeQuestionNumber: activeQuestionData?.questionNumber,
      isPaused: isPaused,
      status: status,
    };
  }

  async getPhase(gameId: number): Promise<GamePhase> {
    return (await this.cache.getPhase(gameId)) || GamePhase.IDLE;
  }

  async prepareQuestion(
    gameId: GameId,
    questionId: number,
    onTick: (
      gameId: GameId,
      sec: number,
      phase: GamePhase,
      qData: QuestionData | null,
    ) => void,
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
      await this.cache.setActiveQuestionData(gameId, {
        questionId,
        questionNumber: questionSettings.questionNumber,
      });

      this.cache.setCallbacks(gameId, onTick, onPhaseChange);

      await this.cache.setPhase(gameId, GamePhase.PREPARATION);
      await this.cache.clearPausedSeconds(gameId);
      await this.cache.clearPhaseEnd(gameId);

      await this.notifyTick(gameId);
      this.logger.log(`Question ${questionId} prepared for game ${gameId}`);
    } catch (e) {
      this.logger.error(`Error preparing question: ${e.message}`);
      throw e;
    }
  }

  async startQuestionCycle(gameId: GameId) {
    const phase = await this.getPhase(gameId);
    if (phase !== GamePhase.PREPARATION) {
      throw new Error('Timer can only be started from PREPARATION phase');
    }

    const qData = await this.cache.getActiveQuestionData(gameId);
    if (!qData) throw new Error('No active question data');

    const settings = await this.gameRepository.getQuestionSettings(
      qData.questionId,
    );

    if (!settings) {
      this.logger.error(
        `Settings for game ${gameId} and question ${qData.questionId} is null`,
      );
      return;
    }

    const totalSeconds = settings?.timeToThink + settings?.timeToAnswer;
    const questionDeadline = Date.now() + totalSeconds * 1000;

    await this.cache.setPhaseEnd(gameId, questionDeadline);
    await this.updateQuestionEnd(qData.questionId, questionDeadline);

    await this.transitionToPhase(
      gameId,
      GamePhase.THINKING,
      settings.timeToThink,
    );
  }

  async processAnswer(data: SubmitAnswerDto): Promise<AnswerDomain | null> {
    const status = await this.cache.getStatus(data.gameId);

    if (status !== GameStatus.LIVE) {
      this.logger.warn(
        `Answer must rejected: game ${data.gameId} is ${status}`,
      );
    }

    try {
      const submittedTimestamp = new Date(data.submittedAt).getTime();
      const safeSubmittedAt = Number.isNaN(submittedTimestamp)
        ? Date.now()
        : submittedTimestamp;

      const deadline = await this.cache.getQuestionDeadline(data.questionId);
      let lateBySeconds: number | undefined = undefined;

      if (deadline && safeSubmittedAt > deadline) {
        lateBySeconds = Math.round((safeSubmittedAt - deadline) / 10) / 100;
      }

      return await this.gameRepository.saveAnswer(
        data.participantId,
        data.questionId,
        data.answer,
        new Date(safeSubmittedAt),
        lateBySeconds,
      );
    } catch (error) {
      this.logger.error(`An error occurred: ${error}`);
      return null;
    }
  }

  async pauseTimer(gameId: GameId) {
    const secondsLeft = await this.calculateRemainingSeconds(gameId);
    this.stopTimer(gameId);

    await this.cache.setPausedSeconds(gameId, secondsLeft);
    await this.cache.clearPhaseEnd(gameId);

    await this.notifyTick(gameId);
  }

  async resumeTimer(gameId: GameId) {
    if (await this.isPaused(gameId)) {
      const pausedSeconds = await this.calculateRemainingSeconds(gameId);
      const qData = await this.cache.getActiveQuestionData(gameId);

      if (pausedSeconds > 0 && qData) {
        const newDeadline = Date.now() + pausedSeconds * 1000;

        await this.cache.setPhaseEnd(gameId, newDeadline);
        await this.cache.clearPausedSeconds(gameId);

        let finalQuestionDeadline = newDeadline;
        const phase = await this.getPhase(gameId);

        if (phase === GamePhase.THINKING) {
          const settings = await this.gameRepository.getQuestionSettings(
            qData.questionId,
          );
          finalQuestionDeadline += (settings?.timeToAnswer ?? 10) * 1000;
        }

        await this.updateQuestionEnd(qData.questionId, finalQuestionDeadline);

        await this.startInterval(gameId);
      }
    }
  }

  private async isPaused(gameId: GameId) {
    return (
      this.cache.getTimer(gameId) === undefined &&
      (await this.getPhase(gameId)) !== GamePhase.IDLE
    );
  }

  async adjustTime(gameId: GameId, delta: number) {
    const phase = await this.getPhase(gameId);
    if (phase === GamePhase.IDLE || phase === GamePhase.PREPARATION) return;

    const currentPhaseDeadline = await this.cache.getPhaseEnd(gameId);
    const qData = await this.cache.getActiveQuestionData(gameId);
    if (currentPhaseDeadline && qData) {
      const deltaMs = delta * 1000;
      const newPhaseDeadline = currentPhaseDeadline + deltaMs;
      await this.cache.setPhaseEnd(gameId, newPhaseDeadline);

      const currentQuestionDeadline = await this.cache.getQuestionDeadline(
        qData.questionId,
      );
      if (currentQuestionDeadline) {
        const newQuestionDeadline = currentQuestionDeadline + deltaMs;
        await this.updateQuestionEnd(qData.questionId, newQuestionDeadline);
      }

      await this.notifyTick(gameId);

      if (newPhaseDeadline <= Date.now()) {
        await this.handlePhaseCompletion(gameId);
      }
    }
  }

  private async transitionToPhase(
    gameId: GameId,
    phase: GamePhase,
    seconds: number,
    deadlineOverride?: number,
  ) {
    const deadline = deadlineOverride ?? Date.now() + seconds * 1000;

    await this.cache.setPhase(gameId, phase);
    await this.cache.setPhaseEnd(gameId, deadline);

    await this.notifyTick(gameId);
    await this.startInterval(gameId);
  }

  private async startInterval(gameId: GameId) {
    if (this.cache.getTimer(gameId) !== undefined) return;

    const interval = setInterval(async () => {
      const seconds = await this.calculateRemainingSeconds(gameId);

      if (seconds > 0) {
        await this.notifyTick(gameId);
      } else {
        await this.handlePhaseCompletion(gameId);
      }
    }, 1000);

    this.cache.setTimer(gameId, interval);
  }

  private async handlePhaseCompletion(gameId: GameId) {
    this.stopTimer(gameId);
    const currentPhase = await this.getPhase(gameId);

    if (currentPhase === GamePhase.THINKING) {
      const questionId = (await this.cache.getActiveQuestionData(gameId))
        ?.questionId;
      const questionSettings = await this.gameRepository.getQuestionSettings(
        questionId!,
      );

      const finalDeadline = questionId
        ? await this.cache.getQuestionDeadline(questionId)
        : undefined;

      await this.transitionToPhase(
        gameId,
        GamePhase.ANSWERING,
        questionSettings?.timeToAnswer ?? 10,
        finalDeadline,
      );
    } else if (currentPhase === GamePhase.ANSWERING) {
      await this.notifyTick(gameId);
    }
  }

  private async notifyTick(gameId: GameId) {
    const onTick = this.cache.getTickCallback(gameId);
    const seconds = await this.calculateRemainingSeconds(gameId);
    const phase = await this.getPhase(gameId);
    const qData = (await this.cache.getActiveQuestionData(gameId)) ?? null;

    if (onTick) {
      onTick(gameId, seconds, phase, qData);
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

  private async calculateRemainingSeconds(gameId: GameId): Promise<number> {
    const paused = await this.cache.getPausedSeconds(gameId);
    if (paused !== undefined) return paused;

    const deadline = await this.cache.getPhaseEnd(gameId);
    if (!deadline) return 0;

    const diff = Math.ceil((deadline - Date.now()) / 1000);
    return Math.max(0, diff);
  }

  private async updateQuestionEnd(
    questionId: number,
    questionDeadline: number,
  ) {
    await this.cache.setQuestionDeadline(questionId, questionDeadline);
    await this.gameRepository.updateQuestionDeadline(
      questionId,
      new Date(questionDeadline),
    );
  }

  async getTeamHistory(participantId: number): Promise<AnswerDomain[]> {
    return this.gameRepository.getParticipantAnswerHistory(participantId);
  }
}
