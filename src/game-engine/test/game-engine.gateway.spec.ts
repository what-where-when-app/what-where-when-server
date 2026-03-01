import { Test, TestingModule } from '@nestjs/testing';
import { GameRepository } from '../../repository/game.repository';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { GameEngineService } from '../main/service/game-engine.service';
import {
  GameBroadcastEvent,
  GameEngineGateway,
} from '../main/controller/game-engine.gateway';
import { WsJwtGuard } from '../main/guards/ws-jwt.guard';
import { GameStatus } from '../../repository/contracts/game-engine.dto';

describe('GameEngineGateway', () => {
  let gateway: GameEngineGateway;
  let service: GameEngineService;

  const mockService = {
    validateHost: jest.fn(),
    startNextQuestion: jest.fn(),
    getGameState: jest.fn(),
    startGame: jest.fn(),
    adminSyncGame: jest.fn(),
  };

  const mockRepo = {
    getAnswersByGame: jest.fn(),
    setParticipantDisconnected: jest.fn(),
  };

  const mockSocket = {
    id: 'socket-id',
    emit: jest.fn(),
    join: jest.fn(),
    to: jest.fn().mockReturnThis(),
    user: { sub: 1 },
  } as unknown as Socket;

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as Server;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameEngineGateway,
        WsJwtGuard,
        { provide: GameEngineService, useValue: mockService },
        { provide: GameRepository, useValue: mockRepo },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get<GameEngineGateway>(GameEngineGateway);
    service = module.get<GameEngineService>(GameEngineService);
    gateway.server = mockServer;
  });

  describe('handleStartGame', () => {
    it('should call service.startGame and broadcast status change', async () => {
      const gameId = 1;
      mockService.validateHost.mockResolvedValue(true);
      mockService.startGame.mockResolvedValue(GameStatus.LIVE);

      await gateway.handleStartGame(mockSocket, { gameId });

      expect(mockService.startGame).toHaveBeenCalledWith(gameId);
      expect(mockServer.to).toHaveBeenCalledWith(`game_${gameId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        GameBroadcastEvent.StatusChanged,
        {
          status: GameStatus.LIVE,
        },
      );
    });
  });

  describe('handleNextQuestion', () => {
    it('should throw error if user is not the host', async () => {
      mockService.validateHost.mockResolvedValue(false);

      await expect(
        gateway.handleNextQuestion(mockSocket, { gameId: 1 }),
      ).rejects.toThrow('Forbidden');
    });

    it('should call service startNextQuestion if user is admin', async () => {
      mockService.validateHost.mockResolvedValue(true);

      await gateway.handleNextQuestion(mockSocket, { gameId: 1 });

      expect(service.startNextQuestion).toHaveBeenCalledWith(
        1,
        expect.any(Function),
      );
    });
  });

  describe('handleAdminSync', () => {
    it('should call adminSyncGame and emit data to admin', async () => {
      const gameId = 1;
      const mockSyncData = {
        state: { status: 'LIVE' },
        answers: [],
        participants: [],
      };

      mockService.validateHost.mockResolvedValue(true);
      mockService.adminSyncGame = jest.fn().mockResolvedValue(mockSyncData);

      await gateway.handleAdminSync(mockSocket, { gameId });

      expect(mockSocket.join).toHaveBeenCalledWith(`game_${gameId}_admins`);
      expect(mockService.adminSyncGame).toHaveBeenCalledWith(gameId);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        GameBroadcastEvent.SyncState,
        mockSyncData,
      );
    });
  });
});
