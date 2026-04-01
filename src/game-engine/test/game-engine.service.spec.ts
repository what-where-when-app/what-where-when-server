import { Test, TestingModule } from '@nestjs/testing';
import { GameRepository } from '../../repository/game.repository';
import {
  GamePhase,
  GameStatus,
} from '../../repository/contracts/game-engine.dto';
import { JudgingNotAllowedError } from '../main/errors/judging-not-allowed.error';
import { GameEngineService } from '../main/service/game-engine.service';
import { GameCacheService } from '../main/service/game-cache.service';

describe('GameEngineService', () => {
  let service: GameEngineService;

  const dummyTimer = setTimeout(() => {}, 0) as unknown as NodeJS.Timeout;
  clearTimeout(dummyTimer);

  const mockGameRepository = {
    findById: jest.fn(),
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
    getAnswerByIdForGame: jest.fn(),
    judgeAnswer: jest.fn(),
    createDispute: jest.fn(),
    getGameSettings: jest.fn(),
    updateQuestionDeadline: jest.fn(),
    findActiveQuestionData: jest.fn(),
    getQuestionDeadline: jest.fn(),
    getParticipantAnswerHistory: jest.fn(),
    clearAllParticipantSockets: jest.fn().mockResolvedValue(0),
  };

  const mockGameCacheService = {
    _phases: new Map(),
    _data: new Map(),
    _statuses: new Map(),
    _timers: new Map(),
    _callbacks: new Map(),
    _phaseEnds: new Map(),
    _pausedSeconds: new Map(),
    _questionDeadlines: new Map(),

    getPhase: jest.fn(
      async (id) => mockGameCacheService._phases.get(id) || GamePhase.IDLE,
    ),
    setPhase: jest.fn(async (id, p) => {
      mockGameCacheService._phases.set(id, p);
    }),
    getStatus: jest.fn(async (id) => mockGameCacheService._statuses.get(id)),
    setStatus: jest.fn(async (id, s) => {
      mockGameCacheService._statuses.set(id, s);
    }),
    getActiveQuestionData: jest.fn(async (id) =>
      mockGameCacheService._data.get(id),
    ),
    setActiveQuestionData: jest.fn(async (id, d) => {
      mockGameCacheService._data.set(id, d);
    }),
    setCallbacks: jest.fn((id, onTick, onPhaseChange) => {
      mockGameCacheService._callbacks.set(id, { onTick, onPhaseChange });
    }),
    getTickCallback: jest.fn(
      (id) => mockGameCacheService._callbacks.get(id)?.onTick,
    ),
    getPhaseChangeCallback: jest.fn(
      (id) => mockGameCacheService._callbacks.get(id)?.onPhaseChange,
    ),
    removeCallbacks: jest.fn((id) => {
      mockGameCacheService._callbacks.delete(id);
    }),
    getTimer: jest.fn((id) => mockGameCacheService._timers.get(id)),
    setTimer: jest.fn((id, t) => {
      mockGameCacheService._timers.set(id, t);
    }),
    clearTimer: jest.fn((id) => {
      const t = mockGameCacheService._timers.get(id);
      if (t) clearInterval(t);
      mockGameCacheService._timers.delete(id);
    }),
    getPhaseEnd: jest.fn(async (id) => mockGameCacheService._phaseEnds.get(id)),
    setPhaseEnd: jest.fn(async (id, t) => {
      mockGameCacheService._phaseEnds.set(id, t);
    }),
    clearPhaseEnd: jest.fn(async (id) => {
      mockGameCacheService._phaseEnds.delete(id);
    }),
    getPausedSeconds: jest.fn(async (id) =>
      mockGameCacheService._pausedSeconds.get(id),
    ),
    setPausedSeconds: jest.fn(async (id, s) => {
      mockGameCacheService._pausedSeconds.set(id, s);
    }),
    clearPausedSeconds: jest.fn(async (id) => {
      mockGameCacheService._pausedSeconds.delete(id);
    }),
    getQuestionDeadline: jest.fn(async (id) =>
      mockGameCacheService._questionDeadlines.get(id),
    ),
    setQuestionDeadline: jest.fn(async (id, t) => {
      mockGameCacheService._questionDeadlines.set(id, t);
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

    [
      mockGameCacheService._phases,
      mockGameCacheService._data,
      mockGameCacheService._statuses,
      mockGameCacheService._timers,
      mockGameCacheService._callbacks,
      mockGameCacheService._phaseEnds,
      mockGameCacheService._pausedSeconds,
      mockGameCacheService._questionDeadlines,
    ].forEach((m) => m.clear());

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('clears all participant socket bindings on startup', async () => {
      mockGameRepository.clearAllParticipantSockets.mockResolvedValue(2);
      const moduleRef = await Test.createTestingModule({
        providers: [
          GameEngineService,
          { provide: GameCacheService, useValue: mockGameCacheService },
          { provide: GameRepository, useValue: mockGameRepository },
        ],
      }).compile();
      await moduleRef.init();
      expect(mockGameRepository.clearAllParticipantSockets).toHaveBeenCalledTimes(
        1,
      );
      await moduleRef.close();
    });
  });

  describe('Game Lifecycle (Start/Finish)', () => {
    it('startGame: should transition DRAFT to LIVE', async () => {
      mockGameCacheService._statuses.set(1, GameStatus.DRAFT);
      mockGameRepository.updateStatus.mockResolvedValue({
        status: GameStatus.LIVE,
      });

      const result = await service.startGame(1);
      expect(result).toBe(GameStatus.LIVE);
      expect(mockGameCacheService.setStatus).toHaveBeenCalledWith(
        1,
        GameStatus.LIVE,
      );
    });

    it('startGame: should throw if game is FINISHED', async () => {
      mockGameCacheService._statuses.set(1, GameStatus.FINISHED);
      await expect(service.startGame(1)).rejects.toThrow('already finished');
    });

    it('finishGame: should cleanup timer and set status', async () => {
      mockGameCacheService._timers.set(1, dummyTimer);
      await service.finishGame(1);
      expect(mockGameCacheService.clearTimer).toHaveBeenCalledWith(1);
      expect(mockGameRepository.updateStatus).toHaveBeenCalledWith(
        1,
        GameStatus.FINISHED,
      );
    });
  });

  describe('Question Flow', () => {
    it('prepareQuestion: should reset deadlines and set PREPARATION phase', async () => {
      mockGameCacheService._statuses.set(1, GameStatus.LIVE);
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        timeToThink: 60,
        questionNumber: 1,
        gameId: 1,
      });

      await service.prepareQuestion(1, 101, jest.fn(), jest.fn());

      expect(mockGameCacheService.setPhase).toHaveBeenCalledWith(
        1,
        GamePhase.PREPARATION,
      );
      expect(mockGameCacheService.clearPhaseEnd).toHaveBeenCalled();
      expect(mockGameCacheService.clearPausedSeconds).toHaveBeenCalled();
    });

    it('startQuestionCycle: should set absolute questionDeadline (T+A)', async () => {
      const now = 1000000;
      jest.setSystemTime(now);
      mockGameCacheService._phases.set(1, GamePhase.PREPARATION);
      mockGameCacheService._data.set(1, { questionId: 101 });
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        timeToThink: 60,
        timeToAnswer: 10,
      });

      await service.startQuestionCycle(1);

      const expectedEnd = now + 70000;
      expect(mockGameRepository.updateQuestionDeadline).toHaveBeenCalledWith(
        101,
        new Date(expectedEnd),
      );
      expect(mockGameCacheService.setQuestionDeadline).toHaveBeenCalledWith(
        101,
        expectedEnd,
      );
      expect(mockGameCacheService._phases.get(1)).toBe(GamePhase.THINKING);
    });

    it('startNextQuestion: should find next ID and prepare it', async () => {
      mockGameCacheService._data.set(1, { questionId: 101 });
      mockGameRepository.getOrderedQuestionIds.mockResolvedValue([101, 102]);
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        gameId: 1,
        questionNumber: 2,
      });
      mockGameCacheService._statuses.set(1, GameStatus.LIVE);

      const result = await service.startNextQuestion(1, jest.fn());
      expect(result).toBe(102);
      expect(mockGameRepository.activateQuestion).toHaveBeenCalledWith(1, 102);
    });
  });

  describe('Timer Logic (Absolute Time)', () => {
    it('should transition THINKING -> ANSWERING using the stored questionDeadline', async () => {
      const now = 1000000;
      const questionEnd = now + 70000;
      jest.setSystemTime(now);

      mockGameCacheService._phases.set(1, GamePhase.THINKING);
      mockGameCacheService._data.set(1, { questionId: 101 });
      mockGameCacheService._questionDeadlines.set(101, questionEnd);
      mockGameRepository.getQuestionSettings.mockResolvedValue({
        timeToAnswer: 10,
      });

      mockGameCacheService.getPhaseEnd.mockResolvedValue(now);

      // @ts-expect-error private method
      await service.handlePhaseCompletion(1);

      expect(mockGameCacheService._phases.get(1)).toBe(GamePhase.ANSWERING);
      expect(mockGameCacheService.setPhaseEnd).toHaveBeenCalledWith(
        1,
        questionEnd,
      );
    });

    // TODO: rework tests to reset properly
    xit('pause/resume: should preserve exactly the remaining time', async () => {
      const gameId = 1;
      const questionId = 101;
      const now = 1000000;
      const deadline = now + 30000;

      jest.setSystemTime(now);

      mockGameCacheService._phaseEnds.set(gameId, deadline);
      mockGameCacheService._phases.set(gameId, GamePhase.THINKING);
      mockGameCacheService._timers.set(gameId, dummyTimer);

      const onTick = jest.fn();
      mockGameCacheService.setCallbacks(gameId, onTick, jest.fn());

      await service.pauseTimer(gameId);

      expect(mockGameCacheService.setPausedSeconds).toHaveBeenCalledWith(
        gameId,
        30,
      );
      expect(mockGameCacheService.clearPhaseEnd).toHaveBeenCalledWith(gameId);

      expect(onTick).toHaveBeenCalledWith(gameId, 30, GamePhase.THINKING, null);

      const resumeTime = 2000000;
      jest.setSystemTime(resumeTime);

      mockGameCacheService._pausedSeconds.set(gameId, 30);
      mockGameCacheService._data.set(gameId, { questionId });

      await service.resumeTimer(gameId);

      const expectedNewDeadline = resumeTime + 30000;
      expect(mockGameCacheService.setPhaseEnd).toHaveBeenCalledWith(
        gameId,
        expectedNewDeadline,
      );
      expect(mockGameCacheService.clearPausedSeconds).toHaveBeenCalledWith(
        gameId,
      );
    });

    it('adjustTime: should move both phaseEnd and questionDeadline', async () => {
      const qDeadline = 1050000;
      mockGameCacheService._phases.set(1, GamePhase.THINKING);
      mockGameCacheService._phaseEnds.set(1, 1000000);
      mockGameCacheService._data.set(1, { questionId: 101 });
      mockGameCacheService._questionDeadlines.set(101, qDeadline);

      await service.adjustTime(1, 5); // +5 сек

      expect(mockGameCacheService.setPhaseEnd).toHaveBeenCalledWith(1, 1005000);
      expect(mockGameRepository.updateQuestionDeadline).toHaveBeenCalledWith(
        101,
        new Date(qDeadline + 5000),
      );
    });
  });

  describe('Answers & Disputes', () => {
    it('processAnswer: should calculate lateBySeconds based on client timestamp', async () => {
      const qDeadline = 1000000;
      const clientTime = 1003000; // 3 сек опоздания
      mockGameCacheService._statuses.set(1, GameStatus.LIVE);
      mockGameCacheService._questionDeadlines.set(101, qDeadline);

      const dto = {
        gameId: 1,
        participantId: 5,
        questionId: 101,
        answer: 'test',
        submittedAt: new Date(clientTime).toISOString(),
      };
      await service.processAnswer(dto);

      expect(mockGameRepository.saveAnswer).toHaveBeenCalledWith(
        5,
        101,
        'test',
        expect.any(Date),
        3,
      );
    });

    it('processAnswer: should handle invalid dates by falling back to server time', async () => {
      mockGameCacheService._statuses.set(1, GameStatus.LIVE);
      const dto = {
        gameId: 1,
        participantId: 5,
        questionId: 101,
        answer: 'test',
        submittedAt: 'garbage',
      };

      await service.processAnswer(dto);
      expect(mockGameRepository.saveAnswer).toHaveBeenCalledWith(
        5,
        101,
        'test',
        expect.any(Date),
        undefined,
      );
    });

    it('judgeAnswer: should return updated answer and leaderboard', async () => {
      mockGameRepository.getAnswerByIdForGame.mockResolvedValue({
        id: 10,
        questionId: 101,
        status: 'CORRECT',
      });
      mockGameRepository.judgeAnswer.mockResolvedValue({
        gameParticipantId: 12,
        socketId: 1111,
      });
      mockGameRepository.getParticipantAnswerHistory.mockResolvedValue([]);

      const result = await service.judgeAnswer(1, 10, 'CORRECT', 99);
      expect(result.updatedAnswer.status).toBe('CORRECT');
      expect(mockGameRepository.getAnswerByIdForGame).toHaveBeenCalledWith(
        10,
        1,
      );
    });

    it('judgeAnswer: should reject while THINKING on the same active question', async () => {
      mockGameCacheService._phases.set(1, GamePhase.THINKING);
      mockGameCacheService._data.set(1, { questionId: 101, questionNumber: 1 });
      mockGameRepository.getAnswerByIdForGame.mockResolvedValue({
        id: 10,
        questionId: 101,
        status: 'UNSET',
      });

      await expect(
        service.judgeAnswer(1, 10, 'CORRECT', 99),
      ).rejects.toBeInstanceOf(JudgingNotAllowedError);
      expect(mockGameRepository.judgeAnswer).not.toHaveBeenCalled();
    });

    it('judgeAnswer: should reject while ANSWERING on the same active question', async () => {
      mockGameCacheService._phases.set(1, GamePhase.ANSWERING);
      mockGameCacheService._data.set(1, { questionId: 55, questionNumber: 3 });
      mockGameRepository.getAnswerByIdForGame.mockResolvedValue({
        id: 10,
        questionId: 55,
        status: 'UNSET',
      });

      await expect(
        service.judgeAnswer(1, 10, 'CORRECT', 99),
      ).rejects.toBeInstanceOf(JudgingNotAllowedError);
      expect(mockGameRepository.judgeAnswer).not.toHaveBeenCalled();
    });

    it('judgeAnswer: should allow while THINKING if answer is for another question', async () => {
      mockGameCacheService._phases.set(1, GamePhase.THINKING);
      mockGameCacheService._data.set(1, { questionId: 102, questionNumber: 2 });
      mockGameRepository.getAnswerByIdForGame.mockResolvedValue({
        id: 10,
        questionId: 101,
        status: 'UNSET',
      });
      mockGameRepository.judgeAnswer.mockResolvedValue({
        gameParticipantId: 12,
        socketId: null,
      });
      mockGameRepository.getParticipantAnswerHistory.mockResolvedValue([]);

      await service.judgeAnswer(1, 10, 'CORRECT', 99);
      expect(mockGameRepository.judgeAnswer).toHaveBeenCalled();
    });
  });

  describe('Stop Logic', () => {
    it('stopQuestion: should set IDLE but NOT clear phaseEnd (to allow late packets)', async () => {
      mockGameCacheService._statuses.set(1, GameStatus.LIVE);
      mockGameCacheService._timers.set(1, dummyTimer);

      await service.stopQuestion(1);

      expect(mockGameCacheService.setPhase).toHaveBeenCalledWith(
        1,
        GamePhase.IDLE,
      );
      expect(mockGameCacheService.clearPhaseEnd).not.toHaveBeenCalled();
    });
  });
});
