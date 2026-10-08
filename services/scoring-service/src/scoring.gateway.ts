import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ScoringService } from './scoring.service';
import { Logger } from '@nestjs/common';
import { corsAllowlist } from './env';

/**
 * Read/broadcast gateway only.
 *
 * This socket previously also exposed `record-ball` and `undo-ball` handlers,
 * which called `ScoringService.recordBall` / `undoBall` directly — bypassing the
 * HTTP controller, `ScoringServiceAuthGuard` and the tenant scope that now guards
 * every write. They had **zero callers**: `use-scoring-socket.ts` only emits
 * `join-match` / `leave-match` and writes go through the web server actions, so
 * this was an unreachable write surface with weaker auth than the real one.
 *
 * Scoring is single-writer by design: all mutations flow
 * web server action -> `POST /scoring/*` (service token + `x-tenant-id`) ->
 * `ScoringService`. If WebSocket writes are ever needed (e.g. the mobile offline
 * queue), they must go through the same guarded HTTP path rather than
 * reintroducing a second entry point here.
 */
@WebSocketGateway({
  cors: {
    origin: corsAllowlist(),
    credentials: true,
  },
  namespace: '/scoring',
})
export class ScoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ScoringGateway.name);

  @WebSocketServer()
  server: Server;

  private connectedClients: Map<string, Set<string>> = new Map(); // matchId -> socketIds

  constructor(private readonly scoringService: ScoringService) {}

  handleConnection(client: Socket) {
    // Anonymous connections are intentional: this namespace only reads and
    // broadcasts public scorecard state, which is already unauthenticated via
    // `GET /scoring/match/:matchId/state`.
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Remove from all match rooms
    this.connectedClients.forEach((clients, matchId) => {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.connectedClients.delete(matchId);
      }
    });
  }

  @SubscribeMessage('join-match')
  async handleJoinMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ) {
    const { matchId } = data;

    if (!matchId) {
      return { success: false, error: 'matchId is required' };
    }

    // Join the match room
    await client.join(`match:${matchId}`);
    
    // Track connected clients
    if (!this.connectedClients.has(matchId)) {
      this.connectedClients.set(matchId, new Set());
    }
    this.connectedClients.get(matchId)?.add(client.id);

    // Send current match state
    try {
      const matchState = await this.scoringService.getMatchState(matchId);
      client.emit('match-state', matchState);
    } catch (error) {
      this.logger.error(`Failed to fetch match state for match ${matchId}:`, error instanceof Error ? error.stack : String(error));
      return { success: false, error: 'Unable to load match state' };
    }

    this.logger.log(`Client ${client.id} joined match ${matchId}`);
    return { success: true, matchId };
  }

  @SubscribeMessage('leave-match')
  async handleLeaveMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ) {
    const { matchId } = data;
    
    await client.leave(`match:${matchId}`);
    this.connectedClients.get(matchId)?.delete(client.id);

    this.logger.log(`Client ${client.id} left match ${matchId}`);
    return { success: true };
  }

  @SubscribeMessage('fan-reaction')
  handleFanReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; emoji: string },
  ) {
    if (!data?.matchId || !data?.emoji) {
      return { success: false, error: 'matchId and emoji are required' };
    }
    this.server.to(`match:${data.matchId}`).emit('fan-reaction', { emoji: data.emoji });
    return { success: true };
  }

  // Broadcast match state to all connected clients
  async broadcastMatchState(matchId: string) {
    const matchState = await this.scoringService.getMatchState(matchId);
    this.server.to(`match:${matchId}`).emit('match-state', matchState);
  }

  // Get connected client count for a match
  getConnectedClientsCount(matchId: string): number {
    return this.connectedClients.get(matchId)?.size || 0;
  }
}
