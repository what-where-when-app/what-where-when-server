import {
  Body,
  Controller,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { HostAuthService } from '../auth/host-auth.service';
import { HostJwtAuthGuard } from '../auth/jwt-auth.guard';
import { HostUser } from '../auth/host-user.decorator';
import type { HostJwtPayload } from '../auth/jwt.strategy';
import { HostService } from '../service/host.service';
import type {
  GameId,
  Pagination,
} from '../../../repository/contracts/common.dto';
import {
  HostGameCard,
  HostGameDetails,
} from '../../../repository/contracts/game.dto';
import type {
  HostLoginRequest,
  HostLoginResponse,
  HostPassdropRequest,
  HostPassdropResponse,
  HostRegisterRequest,
  HostRegisterResponse,
} from '../auth/auth.dto';
import { GameExportService } from '../export/game-export.service';

@Controller('host')
export class HostController {
  constructor(
    private readonly auth: HostAuthService,
    private readonly host: HostService,
    private readonly gameExport: GameExportService,
  ) {}

  // ---- Auth ----

  @Post('login')
  login(@Body() body: HostLoginRequest): Promise<HostLoginResponse> {
    return this.auth.login(body.email, body.password);
  }

  @Post('register')
  register(@Body() body: HostRegisterRequest): Promise<HostRegisterResponse> {
    return this.auth.register(body.email, body.password);
  }

  @Post('passdrop')
  passdrop(@Body() body: HostPassdropRequest): HostPassdropResponse {
    return this.auth.passdrop(body.email);
  }

  // ---- Games (protected) ----

  @UseGuards(HostJwtAuthGuard)
  @Post('games')
  async listGames(
    @HostUser() host: HostJwtPayload,
    @Body() body: HostGamesListRequest,
  ): Promise<HostGamesListResponse> {
    return this.host.listGames(
      host.sub,
      body.limit,
      body.offset,
    );
  }

  @UseGuards(HostJwtAuthGuard)
  @Post('games/create')
  async createGame(
    @HostUser() host: HostJwtPayload,
    @Body() body: { title: string; date_of_event: string },
  ): Promise<HostGameGetResponse> {
    return this.host.createGame(host.sub, body.title, body.date_of_event);
  }

  @UseGuards(HostJwtAuthGuard)
  @Post('game/get')
  async getGame(
    @HostUser() host: HostJwtPayload,
    @Body() body: {gameId: number},
  ): Promise<HostGameGetResponse> {
    return this.host.getGame(host.sub, body.gameId);
  }

  @UseGuards(HostJwtAuthGuard)
  @Post('game/save')
  async saveGame(
    @HostUser() host: HostJwtPayload,
    @Body() body: SaveGameRequest,
  ): Promise<SaveGameResponse> {
    return this.host.saveGame(host.sub, body);
  }

  @UseGuards(HostJwtAuthGuard)
  @Post('game/export-game')
  async exportGame(
    @HostUser() host: HostJwtPayload,
    @Body() body: { game_id: number },
  ): Promise<StreamableFile> {
    const buffer = await this.gameExport.buildGameXlsx(host.sub, body.game_id);
    const filename = `Game_${body.game_id}.xlsx`;
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}

export interface HostGamesListResponse {
  items: HostGameCard[];
  pagination: Pagination;
}

export interface HostGameGetResponse {
  game: HostGameDetails;
}

export interface SaveGameRequest {
  game_id: GameId;
  version: number;
  game: Omit<
    HostGameDetails,
    'id' | 'updated_at' | 'version' | 'status' | 'passcode'
  >;

  deleted_round_ids?: GameId[];
  deleted_question_ids?: GameId[];
  deleted_team_ids?: GameId[];
  deleted_category_ids?: GameId[];
}

export interface SaveGameResponse {
  game: HostGameDetails;
}

export interface HostGamesListRequest {
  limit?: number;
  offset?: number;
}

