import { UseGuards, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameEngineService } from '../service/game-engine.service';
import { GameRepository } from '../../../repository/game.repository';
import { WsJwtGuard } from '../guards/ws-jwt.guard';
import type {
  AdjustTimeDto,
  DisputeDto,
  JoinGameDto,
  JudgeAnswerDto,
  StartQuestionDto,
  SubmitAnswerDto,
} from '../../../repository/contracts/game-engine.dto';

/**
 * Events sent from the Host/Admin to the Server
 */
export enum AdminRequestEvent {
  Sync = 'admin:sync', // Initial synchronization: joins admin room and fetches all game data
  StartGame = 'admin:start_game', // Transitions game status from DRAFT to LIVE
  StartQuestion = 'admin:start_question', // Triggers the start of a specific question cycle
  JudgeAnswer = 'admin:judge_answer', // Submits host's verdict (correct/wrong) for a team's answer
  AdjustTime = 'admin:adjust_time', // Adds or subtracts seconds from the current active timer
  PauseTimer = 'admin:pause_timer', // Pauses the current question timer
  ResumeTimer = 'admin:resume_timer', // Resumes the current question timer
  NextQuestion = 'admin:next_question',
  FinishGame = 'admin:finish_game',
}

/**
 * Events sent from the Server specifically to Admins
 */
export enum AdminResponseEvent {
  AnswerUpdate = 'admin:answer_update', // Pushes a single AnswerDomain object when a team submits or host judges
  NewDispute = 'admin:new_dispute', // Notifies admins about a team raising a dispute
}

/**
 * Events sent from the Player to the Server
 */
export enum PlayerRequestEvent {
  JoinGame = 'join_game', // Initial request to join the public game room
  SubmitAnswer = 'player:submit_answer', // Sends the team's answer text to the server
  Dispute = 'player:dispute', // Team challenges a host's verdict
}

/**
 * Events sent from the Server specifically to a Player
 */
export enum PlayerResponseEvent {
  AnswerReceived = 'answer_received',   // Confirmation that the team's answer was successfully saved
}

/**
 * Global broadcast events sent by the Server to all connected clients in the game room
 */
export enum GameBroadcastEvent {
  SyncState = 'sync_state', // Response to sync requests: provides current phase, timer, and active question
  TimerUpdate = 'timer_update', // Periodic tick providing current seconds and active phase
  StatusChanged = 'game_status_changed', // Notification when game moves to LIVE or FINISHED status
  LeaderboardUpdate = 'leaderboard_update', // Pushes the latest team scores/rankings
  TimerPaused = 'timer_paused',
  TimerResumed = 'timer_resumed',
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: 'game' })
export class GameEngineGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(GameEngineGateway.name);

  constructor(
    private readonly gameService: GameEngineService,
    private readonly gameRepository: GameRepository,
  ) {}

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.NextQuestion)
  async handleNextQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);

    await this.gameService.startNextQuestion(
      data.gameId,
      (gId, seconds, phase, qId) => {
        this.server.to(this.getRoom(gId)).emit(GameBroadcastEvent.TimerUpdate, {
          seconds,
          phase,
          activeQuestionId: qId,
        });
      },
    );
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.Sync)
  async handleAdminSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);
    client.join(this.getAdminRoom(data.gameId));
    client.join(this.getRoom(data.gameId));
    client.emit(
      GameBroadcastEvent.SyncState,
      await this.gameService.adminSyncGame(data.gameId),
    );
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.StartGame)
  async handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);

    const currentStatus = await this.gameService.startGame(data.gameId);

    this.server
      .to(this.getRoom(data.gameId))
      .emit(GameBroadcastEvent.StatusChanged, {
        status: currentStatus,
      });
  }

  async handleDisconnect(client: Socket) {
    await this.gameRepository.setParticipantDisconnected(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(PlayerRequestEvent.JoinGame)
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinGameDto,
  ) {
    try {
      const config = await this.gameService.getGameConfigAndJoinGame(
        data.gameId,
        data.teamId,
        client.id,
      );

      client.join(this.getRoom(data.gameId));
      client.emit(GameBroadcastEvent.SyncState, {
        state: config.state,
        participantId: config.participantId,
      });

      this.server
        .to(this.getAdminRoom(data.gameId))
        .emit(GameBroadcastEvent.SyncState, {
          participants: config.participants,
        });

      this.logger.log(
        `Client ${client.id} joined team ${data.teamId} in game ${data.gameId}`,
      );
    } catch (e) {
      client.emit('error', { message: e.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.StartQuestion)
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: StartQuestionDto,
  ) {
    await this.ensureAdmin(data.gameId, client);

    await this.gameService.startQuestionCycle(
      data.gameId,
      data.questionId,
      (gId, seconds, phase, qId) => {
        this.server.to(this.getRoom(gId)).emit(GameBroadcastEvent.TimerUpdate, {
          seconds,
          phase,
          activeQuestionId: qId,
        });
      },
      (phase) => {
        this.logger.log(`Game ${data.gameId} phase changed to ${phase}`);
      },
    );
  }

  @SubscribeMessage(PlayerRequestEvent.SubmitAnswer)
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SubmitAnswerDto,
  ) {
    const result = await this.gameService.processAnswer(data);

    if (result) {
      client.emit(PlayerResponseEvent.AnswerReceived, { status: 'ok' });
      this.server
        .to(this.getAdminRoom(data.gameId))
        .emit(AdminResponseEvent.AnswerUpdate, result);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.JudgeAnswer)
  async handleJudge(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JudgeAnswerDto,
  ) {
    await this.ensureAdmin(data.gameId, client);

    const { updatedAnswer, leaderboard } = await this.gameService.judgeAnswer(
      data.gameId,
      data.answerId,
      data.verdict,
      client['user'].sub,
    );

    this.server
      .to(this.getAdminRoom(data.gameId))
      .emit(AdminResponseEvent.AnswerUpdate, updatedAnswer);

    this.server
      .to(this.getRoom(data.gameId))
      .emit(GameBroadcastEvent.LeaderboardUpdate, leaderboard);
  }

  @SubscribeMessage(PlayerRequestEvent.Dispute)
  async handleDispute(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: DisputeDto,
  ) {
    try {
      const { updatedAnswer, leaderboard } =
        await this.gameService.raiseDispute(
          data.gameId,
          data.answerId,
          data.comment || 'No comment provided',
        );

      this.server
        .to(this.getAdminRoom(data.gameId))
        .emit(AdminResponseEvent.AnswerUpdate, updatedAnswer);

      this.server
        .to(this.getAdminRoom(data.gameId))
        .emit(AdminResponseEvent.NewDispute, { answerId: data.answerId });

      this.server
        .to(this.getRoom(data.gameId))
        .emit(GameBroadcastEvent.LeaderboardUpdate, leaderboard);
    } catch (e) {
      client.emit('error', { message: e.message });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.PauseTimer)
  async handlePause(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);
    await this.gameService.pauseTimer(data.gameId);
    this.server
      .to(this.getRoom(data.gameId))
      .emit(GameBroadcastEvent.TimerPaused);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.ResumeTimer)
  async handleResume(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);
    await this.gameService.resumeTimer(data.gameId);
    this.server
      .to(this.getRoom(data.gameId))
      .emit(GameBroadcastEvent.TimerResumed);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.AdjustTime)
  async handleAdjust(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AdjustTimeDto,
  ) {
    await this.ensureAdmin(data.gameId, client);
    await this.gameService.adjustTime(data.gameId, data.delta);
  }

  private async ensureAdmin(gameId: number, client: Socket) {
    const userId = client['user']?.sub;
    const isAdmin = await this.gameService.validateHost(gameId, userId);
    if (!isAdmin) {
      throw new WsException('Forbidden: You are not the host of this game');
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage(AdminRequestEvent.FinishGame)
  async handleFinishGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: number },
  ) {
    await this.ensureAdmin(data.gameId, client);
    const status = await this.gameService.finishGame(data.gameId);

    this.server
      .to(this.getRoom(data.gameId))
      .emit(GameBroadcastEvent.StatusChanged, {
        status,
      });
  }

  private getRoom(gameId: number) {
    return `game_${gameId}`;
  }

  private getAdminRoom(gameId: number) {
    return `game_${gameId}_admins`;
  }
}
