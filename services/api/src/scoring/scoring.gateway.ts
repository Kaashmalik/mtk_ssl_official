import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger, UseGuards, UsePipes, ValidationPipe } from "@nestjs/common";
import { ScoringService } from "./scoring.service";
import { env } from "../env";
import { JoinMatchDto } from "./dto/join-match.dto";
import { BallAddedDto } from "./dto/ball-added.dto";
import { BallUndoDto } from "./dto/ball-undo.dto";
import { LeaveMatchDto } from "./dto/leave-match.dto";
import { BearerTokenWsGuard } from "../common/guards/bearer-token-ws.guard";
import { redactSensitiveData, safeSerialize } from "../common/utils/redact";
import { isOriginAllowed } from "../common/cors/tenant-cors";
import { ScoringEvents } from "./scoring.events";

@UseGuards(BearerTokenWsGuard)
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = isOriginAllowed(origin);
      callback(allowed ? null : new Error("CORS blocked"), allowed);
    },
    credentials: true,
  },
  maxHttpBufferSize: env.WS_MAX_PAYLOAD_BYTES,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin as string | undefined;
    const originAllowed = isOriginAllowed(origin);

    if (!originAllowed) {
      callback("CORS blocked", false);
      return;
    }

    const tenantId =
      (req.headers["x-tenant-id"] as string | undefined) ||
      (req.headers["x-tenant"] as string | undefined);

    if (env.TENANT_HEADER_REQUIRED && !tenantId) {
      callback("Missing tenant header", false);
      return;
    }

    if (!env.AUTH_REQUIRED) {
      callback(null, true);
      return;
    }

    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : authHeader;

    if (token && token === env.API_AUTH_TOKEN) {
      callback(null, true);
      return;
    }

    callback("Unauthorized", false);
  },
  namespace: "/",
})
export class ScoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ScoringGateway.name);

  constructor(private readonly scoringService: ScoringService) {}

  private logEvent(eventName: string, payload: unknown, clientId: string) {
    if (!env.WS_LOG_PAYLOAD) {
      this.logger.log(`WS ${eventName} client=${clientId}`);
      return;
    }

    const redacted = redactSensitiveData(payload);
    const serialized = safeSerialize(redacted, env.WS_LOG_MAX_BYTES);
    this.logger.log(`WS ${eventName} client=${clientId} payload=${serialized}`);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up any match subscriptions
    const rooms = Array.from(client.rooms);
    rooms.forEach((room) => {
      if (room.startsWith("match:")) {
        client.leave(room);
      }
    });
  }

  @SubscribeMessage(ScoringEvents.JoinMatch)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  )
  async handleJoinMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinMatchDto
  ) {
    try {
      this.logEvent("join-match", payload, client.id);
      const room = `match:${payload.matchId}`;
      await client.join(room);
      this.logger.log(`Client ${client.id} joined match ${payload.matchId}`);

      // Send current match state to the new client
      const matchState = await this.scoringService.getMatchState(payload.matchId);
      client.emit(ScoringEvents.MatchState, matchState);

      // Notify other clients
      client.to(room).emit(ScoringEvents.ScorerJoined, {
        matchId: payload.matchId,
        scorerId: client.id,
      });

      return { success: true, matchId: payload.matchId };
    } catch (error) {
      this.logger.error(`Error joining match: ${error.message}`);
      client.emit("error", { message: "Failed to join match" });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage(ScoringEvents.BallAdded)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  )
  async handleBallAdded(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: BallAddedDto
  ) {
    try {
      this.logEvent("ball-added", data, client.id);
      const { matchId, ballData } = data;
      this.logger.log(`Ball added for match ${matchId} by ${client.id}`);

      // Save ball to database
      const savedBall = await this.scoringService.addBall(matchId, ballData);

      // Broadcast to all clients in the match room
      const room = `match:${matchId}`;
      this.server.to(room).emit(ScoringEvents.BallAdded, {
        matchId,
        ball: savedBall,
        scorerId: client.id,
      });

      // Update match state
      const matchState = await this.scoringService.getMatchState(matchId);
      this.server.to(room).emit(ScoringEvents.MatchStateUpdated, matchState);

      return { success: true, ball: savedBall };
    } catch (error) {
      this.logger.error(`Error adding ball: ${error.message}`);
      client.emit("error", { message: "Failed to add ball" });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage(ScoringEvents.BallUndo)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  )
  async handleBallUndo(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: BallUndoDto
  ) {
    try {
      this.logEvent("ball-undo", data, client.id);
      const { matchId, ballId } = data;
      this.logger.log(`Ball undo for match ${matchId}, ball ${ballId}`);

      // Remove ball from database
      await this.scoringService.removeBall(matchId, ballId);

      // Broadcast to all clients
      const room = `match:${matchId}`;
      this.server.to(room).emit(ScoringEvents.BallRemoved, {
        matchId,
        ballId,
        scorerId: client.id,
      });

      // Update match state
      const matchState = await this.scoringService.getMatchState(matchId);
      this.server.to(room).emit(ScoringEvents.MatchStateUpdated, matchState);

      return { success: true };
    } catch (error) {
      this.logger.error(`Error undoing ball: ${error.message}`);
      client.emit("error", { message: "Failed to undo ball" });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage(ScoringEvents.LeaveMatch)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  )
  async handleLeaveMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveMatchDto
  ) {
    this.logEvent("leave-match", payload, client.id);
    const room = `match:${payload.matchId}`;
    await client.leave(room);
    this.logger.log(`Client ${client.id} left match ${payload.matchId}`);

    client.to(room).emit(ScoringEvents.ScorerLeft, {
      matchId: payload.matchId,
      scorerId: client.id,
    });

    return { success: true };
  }
}

