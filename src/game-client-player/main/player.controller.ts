import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { PlayerService } from './player.service';
import type { FeedbackScreen, SubmitPlayerFeedbackDto } from './player-feedback.dto';
import { LeaderboardEntry } from '../../repository/contracts/game-engine.dto';

@Controller('player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('check-game')
  async checkGame(@Body() dto: CheckGameDto): Promise<CheckGameResponse> {
    return this.playerService.checkGameByCode(dto.gameCode);
  }

  @Get('game/:gameId/leaderboard')
  async getGameLeaderboard(@Param('gameId') gameId: string): Promise<LeaderboardEntry[]> {
    const id = Number.parseInt(gameId, 10);
    if (Number.isNaN(id) || id < 1) {
      throw new BadRequestException({ message: 'Invalid game id' });
    }
    return this.playerService.getLeaderboardForGame(id);
  }

  @Get('feedback-form')
  getFeedbackForm(): FeedbackScreen {
    return this.playerService.getPlayerFeedbackForm();
  }

  @Post('feedback')
  async submitFeedback(
    @Body() body: SubmitPlayerFeedbackDto,
  ): Promise<{ ok: boolean }> {
    return this.playerService.submitAppFeedback(body);
  }
}

interface CheckGameDto {
  gameCode: number;
}

export interface CheckGameResponse {
  gameId: number;
  gameName: string;
  teams: Teams[];
}

interface Teams {
  teamId: number;
  name: string;
  isAvailable: boolean;
}
