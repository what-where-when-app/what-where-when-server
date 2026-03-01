import { AnswerStatus } from '../contracts/game-engine.dto';
import { AnswerMapper } from '../mappers/host-game.mapper';

describe('AnswerMapper', () => {
  describe('toDomain', () => {
    it('should correctly map raw database object to AnswerDomain', () => {
      const now = new Date();
      const raw = {
        id: 1,
        questionId: 10,
        gameParticipantId: 20,
        answerText: 'Sample Answer',
        submittedAt: now,
        status: { name: 'CORRECT' },
        participant: {
          team: { name: 'Super Team' },
        },
      };

      const result = AnswerMapper.toDomain(raw);

      expect(result).toEqual({
        id: 1,
        questionId: 10,
        participantId: 20,
        teamName: 'Super Team',
        answerText: 'Sample Answer',
        status: 'CORRECT',
        submittedAt: now.toISOString(),
      });
    });

    it('should handle missing team or status by providing defaults', () => {
      const now = new Date();
      const raw = {
        id: 1,
        questionId: 10,
        gameParticipantId: 20,
        answerText: 'Hello',
        submittedAt: now,
        // status and participant.team are missing
      };

      const result = AnswerMapper.toDomain(raw);

      expect(result.teamName).toBe('Unknown Team');
      expect(result.status).toBe(AnswerStatus.UNSET);
    });
  });
});
