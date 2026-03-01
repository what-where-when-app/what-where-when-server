import { Test, TestingModule } from '@nestjs/testing';
import { GameRepository } from '../../repository/game.repository';
import {
  GamePhase,
  GameStatus,
} from '../../repository/contracts/game-engine.dto';
import { GameEngineService } from '../main/service/game-engine.service';
import { GameCacheService } from '../main/service/game-cache.service';

describe('GameEngineService', () => {
  let service: GameEngineService;

  const mockGameRepository = {
    findById: jest.fn(),
    getGameStructure: jest.fn(),
    updateStatus: jest.fn(),
    activateQuestion: jest.fn(),
    saveAnswer: jest.fn(),
    teamJoinGame: jest.fn(),
    getOrderedQuestionIds: jest.fn(),
    getAnswersByGame: jest.fn(),
    getParticipantsByGame: jest.fn(),
    getQuestionSettings: jest.fn(),
    getLeaderboard: jest.fn(),
    getAnswerById: jest.fn(),
    judgeAnswer: jest.fn(),
    createDispute: jest.fn(),
    getGameSettings: jest.fn(),
  };

  const mockGameCacheService = {
    getPhase: jest.fn(),
    setPhase: jest.fn(),
    getStatus: jest.fn(),
    setStatus: jest.fn(),
    getRemainingSeconds: jest.fn(),
    setRemainingSeconds: jest.fn(),
    getActiveQuestionId: jest.fn(),
    setActiveQuestionId: jest.fn(),
    _callbacks: new Map(),
    setCallbacks: jest.fn(function (id, onTick, onPhaseChange) {
      this._callbacks.set(id, { onTick, onPhaseChange });
    }),
    getTickCallback: jest.fn(function (id) {
      return this._callbacks.get(id)?.onTick;
    }),
    getPhaseChangeCallback: jest.fn(function (id) {
      return this._callbacks.get(id)?.onPhaseChange;
    }),
    removeCallbacks: jest.fn(function (id) {
      this._callbacks.delete(id);
    }),
    _timers: new Map(),
    setTimer: jest.fn(function (id, t) {
      this._timers.set(id, t);
    }),
    getTimer: jest.fn(function (id) {
      return this._timers.get(id);
    }),
    clearTimer: jest.fn(function (id) {
      const t = this._timers.get(id);
      if (t) clearInterval(t);
      this._timers.delete(id);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameEngineService,
        { provide: GameCacheService, useValue: mockGameCacheService },
        { provide: GameRepository, useValue: mockGameRepository },
      ],
    }).compile();

    service = module.get<GameEngineService>(GameEngineService);
    jest.clearAllMocks();
  });

  describe('startGame', () => {
    it('should transition DRAFT game to LIVE', async () => {
      const gameId = 1;
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.DRAFT);
      mockGameRepository.updateStatus.mockResolvedValue({
        id: gameId,
        status: GameStatus.LIVE,
      });

      const result = await service.startGame(gameId);

      expect(result).toBe(GameStatus.LIVE);
      expect(mockGameRepository.updateStatus).toHaveBeenCalledWith(
        gameId,
        GameStatus.LIVE,
      );
      expect(mockGameCacheService.setStatus).toHaveBeenCalledWith(
        gameId,
        GameStatus.LIVE,
      );
    });

    it('should not update if already LIVE', async () => {
      const gameId = 1;
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);

      const result = await service.startGame(gameId);

      expect(result).toBe(GameStatus.LIVE);
      expect(mockGameRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw error if game is FINISHED', async () => {
      const gameId = 1;
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.FINISHED);

      await expect(service.startGame(gameId)).rejects.toThrow(
        'already finished',
      );
      expect(mockGameRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('startQuestionCycle', () => {
    it('should start cycle with durations from database', async () => {
      const gameId = 1;
      const questionId = 101;

      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        timeToThink: 45,
        timeToAnswer: 15,
        gameId: 1,
      });

      await service.startQuestionCycle(
        gameId,
        questionId,
        jest.fn(),
        jest.fn(),
      );

      expect(mockGameCacheService.setRemainingSeconds).toHaveBeenCalledWith(
        gameId,
        45,
      );
      expect(mockGameCacheService.setPhase).toHaveBeenCalledWith(
        gameId,
        GamePhase.THINKING,
      );
    });

    it('should throw error if game is not LIVE', async () => {
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.DRAFT);

      await expect(
        service.startQuestionCycle(1, 101, jest.fn(), jest.fn()),
      ).rejects.toThrow('game is in DRAFT status');
    });

    it('should transition through THINKING -> ANSWERING -> IDLE correctly', async () => {
      jest.useFakeTimers();
      const gameId = 1;
      const questionId = 101;

      let seconds = 60;
      let currentPhase = GamePhase.IDLE;
      let activeQId: number | null = null;

      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        timeToThink: 60,
        timeToAnswer: 10,
        gameId,
      });

      mockGameCacheService.getRemainingSeconds.mockImplementation(
        async () => seconds,
      );
      mockGameCacheService.setRemainingSeconds.mockImplementation(
        async (id, val) => {
          seconds = val;
        },
      );
      mockGameCacheService.getPhase.mockImplementation(
        async () => currentPhase,
      );
      mockGameCacheService.setPhase.mockImplementation(async (id, p) => {
        currentPhase = p;
      });
      mockGameCacheService.getActiveQuestionId.mockImplementation(
        async () => activeQId,
      );
      mockGameCacheService.setActiveQuestionId.mockImplementation(
        async (id, qid) => {
          activeQId = qid;
        },
      );

      const onTick = jest.fn();
      await service.startQuestionCycle(gameId, questionId, onTick, jest.fn());

      expect(currentPhase).toBe(GamePhase.THINKING);
      expect(onTick).toHaveBeenCalledWith(
        gameId,
        60,
        GamePhase.THINKING,
        questionId,
      );

      onTick.mockClear();

      seconds = 0;
      jest.advanceTimersByTime(1000);

      for (let i = 0; i < 15; i++) {
        await Promise.resolve();
      }
      expect(currentPhase).toBe(GamePhase.ANSWERING);
      expect(onTick).toHaveBeenCalledWith(
        gameId,
        10,
        GamePhase.ANSWERING,
        questionId,
      );

      jest.useRealTimers();
    });
  });

  describe('startNextQuestion (Game Flow)', () => {
    it('should start the next question if it exists', async () => {
      const gameId = 1;
      mockGameCacheService.getActiveQuestionId.mockResolvedValue(101);
      mockGameRepository.getOrderedQuestionIds.mockResolvedValue([
        101, 102, 103,
      ]);

      const result = await service.startNextQuestion(gameId, jest.fn());

      expect(result).toBe(102);
      expect(mockGameRepository.activateQuestion).toHaveBeenCalledWith(
        gameId,
        102,
      );
    });

    it('should return null if no more questions', async () => {
      const gameId = 1;
      mockGameCacheService.getActiveQuestionId.mockResolvedValue(103);
      mockGameRepository.getOrderedQuestionIds.mockResolvedValue([
        101, 102, 103,
      ]);

      const result = await service.startNextQuestion(gameId, jest.fn());

      expect(result).toBeNull();
      expect(mockGameRepository.activateQuestion).not.toHaveBeenCalled();
    });
  });

  describe('adminSyncGame', () => {
    it('should collect state, answers and participants in parallel', async () => {
      const gameId = 1;
      const mockState = {
        status: GameStatus.LIVE,
        phase: GamePhase.IDLE,
        seconds: 0,
        isPaused: false,
      };
      const mockAnswers = [{ id: 10, answerText: 'Hello' }];
      const mockParticipants = [{ id: 1, teamName: 'Team A' }];

      jest.spyOn(service, 'getGameState').mockResolvedValue(mockState);
      mockGameRepository.getAnswersByGame.mockResolvedValue(mockAnswers);
      mockGameRepository.getParticipantsByGame.mockResolvedValue(
        mockParticipants,
      );

      const result = await service.adminSyncGame(gameId);

      expect(result).toEqual({
        state: mockState,
        answers: mockAnswers,
        participants: mockParticipants,
      });

      expect(mockGameRepository.getAnswersByGame).toHaveBeenCalledWith(gameId);
      expect(mockGameRepository.getParticipantsByGame).toHaveBeenCalledWith(
        gameId,
      );
    });
  });

  describe('processAnswer (Non-blocking logic)', () => {
    it('should save answer even if phase is IDLE (marking it as late)', async () => {
      const dto = {
        gameId: 1,
        participantId: 5,
        questionId: 101,
        answer: 'Late but saved',
      };

      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.IDLE);
      mockGameCacheService.getActiveQuestionId.mockResolvedValue(null);

      const result = await service.processAnswer(dto);

      expect(mockGameRepository.saveAnswer).toHaveBeenCalledWith(
        5,
        101,
        'Late but saved',
      );
      expect(result).not.toBeNull();
    });

    it('should accept answer during THINKING phase', async () => {
      const dto = {
        gameId: 1,
        participantId: 5,
        questionId: 101,
        answer: 'Early bird',
      };

      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.THINKING);
      mockGameCacheService.getActiveQuestionId.mockResolvedValue(101);

      const result = await service.processAnswer(dto);

      expect(result?.isLate).toBe(false);

      expect(mockGameRepository.saveAnswer).toHaveBeenCalledWith(
        5,
        101,
        'Early bird',
      );
    });

    it('should accept answer during ANSWERING phase', async () => {
      const dto = {
        gameId: 1,
        participantId: 5,
        questionId: 101,
        answer: 'Early bird',
      };

      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.ANSWERING);
      mockGameCacheService.getActiveQuestionId.mockResolvedValue(101);

      const result = await service.processAnswer(dto);

      expect(result?.isLate).toBe(false);

      expect(mockGameRepository.saveAnswer).toHaveBeenCalledWith(
        5,
        101,
        'Early bird',
      );
    });
  });

  describe('getGameConfigAndJoinGame', () => {
    it('should allow joining a LIVE game and return config', async () => {
      const gameId = 1;
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameRepository.teamJoinGame.mockResolvedValue({ id: 10, gameId });
      jest.spyOn(service, 'getGameState').mockResolvedValue({
        status: GameStatus.LIVE,
        phase: GamePhase.IDLE,
        seconds: 0,
        isPaused: false,
      });
      mockGameRepository.getParticipantsByGame.mockResolvedValue([]);

      const result = await service.getGameConfigAndJoinGame(
        gameId,
        1,
        'socket-id',
      );

      expect(result.participantId).toBe(10);
      expect(result.state.status).toBe(GameStatus.LIVE);
      expect(mockGameRepository.teamJoinGame).toHaveBeenCalledWith(
        gameId,
        1,
        'socket-id',
      );
    });

    it('should throw error if game is FINISHED', async () => {
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.FINISHED);

      await expect(
        service.getGameConfigAndJoinGame(1, 1, 'socket-id'),
      ).rejects.toThrow('game is already finished');
    });
  });

  describe('judgeAnswer', () => {
    it('should judge answer and return updated answer with leaderboard', async () => {
      const gameId = 1;
      const answerId = 50;
      const mockAnswer = { id: 50, answerText: 'Test', status: 'CORRECT' };
      const mockLeaderboard = [
        { participantId: 1, teamName: 'Team A', score: 10 },
      ];

      mockGameRepository.judgeAnswer.mockResolvedValue({});
      mockGameRepository.getAnswerById.mockResolvedValue(mockAnswer);
      mockGameRepository.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await service.judgeAnswer(gameId, answerId, 'CORRECT', 99);

      expect(result.updatedAnswer).toEqual(mockAnswer);
      expect(result.leaderboard).toEqual(mockLeaderboard);
      expect(mockGameRepository.judgeAnswer).toHaveBeenCalledWith(
        answerId,
        'CORRECT',
        99,
      );
    });
  });

  describe('raiseDispute', () => {
    it('should raise dispute if enabled in settings', async () => {
      const gameId = 1;
      mockGameRepository.getGameSettings.mockResolvedValue({
        can_appeal: true,
      });
      mockGameRepository.getAnswerById.mockResolvedValue({
        id: 50,
        status: 'DISPUTABLE',
      });
      mockGameRepository.getLeaderboard.mockResolvedValue([]);

      const result = await service.raiseDispute(gameId, 50, 'Wrong!');

      expect(mockGameRepository.createDispute).toHaveBeenCalledWith(
        50,
        'Wrong!',
      );
      expect(result.updatedAnswer.id).toBe(50);
    });

    it('should throw error if appeals are disabled', async () => {
      mockGameRepository.getGameSettings.mockResolvedValue({
        can_appeal: false,
      });

      await expect(service.raiseDispute(1, 50, 'Comment')).rejects.toThrow(
        'Appeals are disabled',
      );
    });
  });

  describe('Timer & Status Management', () => {
    it('should pause the timer and notify subscribers', async () => {
      const gameId = 1;
      const intervalId = setInterval(() => {}, 1000);

      mockGameCacheService.getTimer.mockReturnValue(intervalId);
      mockGameCacheService.getRemainingSeconds.mockResolvedValue(30);
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.THINKING);

      await service.pauseTimer(gameId);

      expect(mockGameCacheService.clearTimer).toHaveBeenCalledWith(gameId);
      expect(mockGameCacheService.getTickCallback).toHaveBeenCalled();
    });

    it('should resume the timer if it was paused', async () => {
      const gameId = 1;

      mockGameCacheService.getTimer.mockReturnValue(undefined);
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.THINKING);
      mockGameCacheService.getRemainingSeconds.mockResolvedValue(30);

      await service.resumeTimer(gameId);

      expect(mockGameCacheService.setTimer).toHaveBeenCalled();
    });

    it('should adjust time and handle completion if seconds reach 0', async () => {
      const gameId = 1;
      mockGameCacheService.getPhase.mockResolvedValue(GamePhase.THINKING);
      mockGameCacheService.getRemainingSeconds.mockResolvedValue(5);
      mockGameCacheService.getTimer.mockReturnValue(
        setInterval(() => {}, 1000)
      );

      await service.adjustTime(gameId, -10);

      expect(mockGameCacheService.setRemainingSeconds).toHaveBeenCalledWith(
        gameId,
        0,
      );
      expect(mockGameCacheService.clearTimer).toHaveBeenCalled();
    });

    it('should finish game and cleanup resources', async () => {
      const gameId = 1;
      mockGameCacheService.getStatus.mockResolvedValue(GameStatus.LIVE);
      mockGameCacheService.getTimer.mockReturnValue(
        setInterval(() => {}, 1000)
      );

      await service.finishGame(gameId);

      expect(mockGameRepository.updateStatus).toHaveBeenCalledWith(
        gameId,
        GameStatus.FINISHED,
      );
      expect(mockGameCacheService.clearTimer).toHaveBeenCalled();
      expect(mockGameCacheService.removeCallbacks).toHaveBeenCalled();
    });
  });
});
