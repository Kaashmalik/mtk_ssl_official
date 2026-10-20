import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * WebSocket gateway for real-time in-app notifications.
 *
 * ENH-01-04 (QUARANTINE): rooms were previously joinable by ANY client-
 * declared `userId`/`tenantId` (handshake query or join events), which let a
 * socket listen to arbitrary private notification feeds. All client-driven
 * room joining is removed - rooms are a server-side emit target only, until
 * an authenticated room-derivation flow replaces joining. Connected sockets
 * therefore receive nothing today; the web bell already degrades to polling.
 *
 * `persistInApp()` still calls `emitToUser()` / `emitToTenant()`; with no
 * room members those emits fan out to nobody until the authenticated flow
 * lands (P06 decision delivery).
 *
 * Port: shares the HTTP server at port 4008 (Socket.io path `/notifications`).
 * This avoids opening a second port, which the plan explicitly rejects.
 */
@WebSocketGateway({
  // Share the existing Express HTTP server — no new port.
  namespace: '/notifications',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false,
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  onModuleInit(): void {
    // gateway is ready
  }

  afterInit(_server: Server): void {
    this.logger.log('Notification WebSocket gateway initialised on /notifications');
  }

  handleConnection(client: Socket): void {
    // Quarantined (ENH-01-04): the handshake query is NEVER trusted for room
    // placement. Identity must come from an authenticated derivation before
    // any private room is joined.
    if (client.handshake.query['userId']) {
      this.logger.warn(`Client ${client.id} sent a client-declared userId; room joining is quarantined`);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * QUARANTINED (ENH-01-04): refuses the legacy client-declared join. Kept as
   * an explicit handler so legacy clients get a no-op instead of an implicit
   * crash, and so the contract is visible in tests.
   */
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    this.logger.warn(`Client ${client.id} requested room join for "${data?.userId ?? ''}"; refused (quarantined)`);
  }

  /** QUARANTINED with the user join: tenant rooms need auth derivation first. */
  @SubscribeMessage('joinTenant')
  handleJoinTenant(
    @MessageBody() data: { tenantId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    this.logger.warn(`Client ${client.id} requested tenant room "${data?.tenantId ?? ''}"; refused (quarantined)`);
  }

  /**
   * Emit a notification event to all sockets in the user's personal room.
   * Called by `NotificationService.persistInApp()` after each successful
   * insert. Server-side only: no client can place itself into this room
   * while joining is quarantined (ENH-01-04).
   *
   * @param userId  The application-internal user UUID (not Clerk ID).
   * @param payload The notification data to broadcast.
   */
  emitToUser(
    userId: string,
    payload: {
      id: string;
      type: string;
      title: string;
      body: string | null;
      createdAt: Date;
    },
  ): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('notification', payload);
    this.logger.debug(`Emitted notification to user:${userId}: ${payload.title}`);
  }

  /**
   * Emit a tenant-wide notification to the tenant room. Server-side only for
   * the same quarantine reason; no client-driven tenant subscription exists.
   */
  emitToTenant(
    tenantId: string,
    payload: {
      type: string;
      title: string;
      body: string | null;
    },
  ): void {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('notification', payload);
  }
}
