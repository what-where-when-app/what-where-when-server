import { Test, TestingModule } from '@nestjs/testing';
import { GameRepository } from '../game.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('GameRepository', () => {
  let repository: GameRepository;

  const mockPrisma = {
    answer: {
      findMany: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
      upsert: jest.fn(),
    },
    game: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    answerStatus: {
      findFirst: jest.fn(),
    },
    gameParticipant: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<GameRepository>(GameRepository);
  });

  describe('getLeaderboard', () => {
    // TODO: write meaningful test
  });

  describe('saveAnswer', () => {
    it('should map saved answer to domain object', async () => {
      mockPrisma.answerStatus.findFirst.mockResolvedValue({ id: 1 });
      const mockSavedAnswer = {
        id: 99,
        questionId: 52,
        gameParticipantId: 18,
        answerText: 'test',
        submittedAt: new Date(),
        status: { name: 'UNSET' },
        participant: { team: { name: 'Team X' } },
      };
      mockPrisma.answer.upsert.mockResolvedValue(mockSavedAnswer);

      const result = await repository.saveAnswer(18, 52, 'test', new Date());

      expect(result.teamName).toBe('Team X');
      expect(result.id).toBe(99);
    });
  });
});
