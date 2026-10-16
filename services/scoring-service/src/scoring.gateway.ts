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
import { z } from 'zod';
import { publicMatchRoom } from './scoring-public-access';
import { PUBLIC_FAN_REACTIONS } from '@mtk/database/lib/public-scoring-events';

const roomInput = z.object({ matchId: z.string().uuid(), tenantId: z.string().uuid() }).strict();
const reactionInput = roomInput.extend({ emoji: z.enum(PUBLIC_FAN_REACTIONS) });
const commentaryInput = z.object({
  matchId: z.string().uuid(), ballId: z.string().uuid(), english: z.string().max(8000),
  urdu: z.string().max(8000).optional(), punjabi: z.string().max(8000).optional(),
  pashto: z.string().max(8000).optional(), sindhi: z.string().max(8000).optional(),
  timestamp: z.string().datetime({ offset: true }), generatedBy: z.enum(['openai', 'cached', 'fallback']),
});

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

  private connectedClients: Map<string, Set<string>> = new Map(); // exact-league public room -> local socket IDs
  private readonly lastReactionByClient = new Map<string, number>();

  constructor(private readonly scoringService: ScoringService) {}

  handleConnection(client: Socket) {
    // A connection is not permission to join a room. Only exact-league,
    // currently published matches can be read on this anonymous namespace.
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
    this.lastReactionByClient.delete(client.id);
  }

  @SubscribeMessage('join-match')
  async handleJoinMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; tenantId: string },
  ) {
    const parsed = roomInput.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Valid matchId and tenantId are required' };
    const { matchId, tenantId } = parsed.data;
    const room = publicMatchRoom(tenantId, matchId);
    try {
      // Publication is checked before joining; no subscribe-then-authorize window.
      const matchState = await this.scoringService.getPublicMatchState(tenantId, matchId);
      if (client.connected === false) return { success: false, error: 'Socket disconnected' };
      await client.join(room);
      if (!this.connectedClients.has(room)) this.connectedClients.set(room, new Set());
      this.connectedClients.get(room)!.add(client.id);
      client.emit('match-state', matchState);
    } catch (error) {
      await client.leave(room);
      this.connectedClients.get(room)?.delete(client.id);
      if (this.connectedClients.get(room)?.size === 0) this.connectedClients.delete(room);
      this.logger.error(`Failed to fetch match state for match ${matchId}:`, error instanceof Error ? error.stack : String(error));
      return { success: false, error: 'Unable to load match state' };
    }

    this.logger.log(`Client ${client.id} joined match ${matchId}`);
    return { success: true, matchId };
  }

  @SubscribeMessage('leave-match')
  async handleLeaveMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; tenantId: string },
  ) {
    const parsed = roomInput.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Valid matchId and tenantId are required' };
    const { matchId, tenantId } = parsed.data;
    const room = publicMatchRoom(tenantId, matchId);
    await client.leave(room);
    this.connectedClients.get(room)?.delete(client.id);
    if (this.connectedClients.get(room)?.size === 0) this.connectedClients.delete(room);

    this.logger.log(`Client ${client.id} left match ${matchId}`);
    return { success: true };
  }

  @SubscribeMessage('fan-reaction')
  async handleFanReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; tenantId: string; emoji: string },
  ) {
    const parsed = reactionInput.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Invalid reaction' };
    const { matchId, tenantId, emoji } = parsed.data;
    const room = publicMatchRoom(tenantId, matchId);
    if (!this.connectedClients.get(room)?.has(client.id)) return { success: false, error: 'Join this match first' };
    const last = this.lastReactionByClient.get(client.id);
    if (last !== undefined && Date.now() - last < 1000) return { success: false, error: 'Please wait before reacting again' };
    this.lastReactionByClient.set(client.id, Date.now());
    try {
      await this.scoringService.assertPublicMatch(tenantId, matchId);
      this.server.to(room).emit('fan-reaction', { tenantId, matchId, emoji });
      return { success: true };
    } catch {
      this.evictPublicRoom(tenantId, matchId);
      return { success: false, error: 'Match updates unavailable' };
    }
  }

  // Broadcast match state to all connected clients
  async broadcastMatchState(tenantId: string, matchId: string) {
    try {
      const matchState = await this.scoringService.getPublicMatchState(tenantId, matchId);
      this.server.to(publicMatchRoom(tenantId, matchId)).emit('match-state', matchState);
    } catch (error) {
      this.evictPublicRoom(tenantId, matchId);
      // The mutation already committed; do not report its broadcast as a failed write.
      this.logger.warn(`Failed to broadcast state for ${matchId}: ${String(error)}`);
    }
  }

  /** Kafka events do not grant publication; resolve their actual league before forwarding. */
  async broadcastCommentary(data: { matchId: string; [key: string]: unknown }) {
    const parsed = commentaryInput.safeParse(data);
    if (!parsed.success) return;
    try {
      const tenantId = await this.scoringService.publishedMatchTenant(parsed.data.matchId);
      this.server.to(publicMatchRoom(tenantId, parsed.data.matchId)).emit('commentary-update', { ...parsed.data, tenantId });
    } catch (error) {
      this.logger.warn(`Commentary publication denied for ${parsed.data.matchId}: ${String(error)}`);
    }
  }

  private evictPublicRoom(tenantId: string, matchId: string) {
    const room = publicMatchRoom(tenantId, matchId);
    this.connectedClients.delete(room);
    try {
      this.server?.to(room).emit('match-unavailable', { tenantId, matchId });
      this.server?.in(room).socketsLeave(room);
    } catch (error) {
      // Transport failure must not turn an already-committed HTTP mutation into
      // an apparent write failure. Every subsequent emit rechecks publication.
      this.logger.warn(`Public room eviction failed for ${matchId}: ${String(error)}`);
    }
  }

  // Get connected client count for a match
  getConnectedClientsCount(tenantId: string, matchId: string): number {
    return this.connectedClients.get(publicMatchRoom(tenantId, matchId))?.size || 0;
  }
}
