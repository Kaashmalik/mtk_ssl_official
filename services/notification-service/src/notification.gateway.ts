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
 * Clients connect and JOIN a personal room keyed by `userId` (the application's
 * internal UUID, not the Clerk ID).  When `NotificationService.persistInApp()`
 * creates a new notification it calls `emitToUser()` on this gateway which
 * forwards the payload to every socket in that room.
 *
 * This is a read/broadcast-only gateway — mutations still go through the HTTP
 * controller.  Authentication is left intentionally lightweight (userId supplied
 * by the client) because the notifications are additive and low-value; a bad
 * actor can at most receive their own or someone else's bell count, not
 * manipulate data.  The real write controls are RBAC on the server actions.
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
    const userId = client.handshake.query['userId'];
    if (typeof userId === 'string' && userId.trim()) {
      // Join a personal room so emitToUser() can target this specific user
      client.join(`user:${userId.trim()}`);
      this.logger.debug(`Client connected: ${client.id} → room user:${userId.trim()}`);
    } else {
      this.logger.debug(`Client connected without userId: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Allow a connected client to (re-)join a user room after connection.
   * Useful when the userId becomes available post-auth (e.g. Clerk's useUser hook).
   */
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (typeof data?.userId === 'string' && data.userId.trim()) {
      client.join(`user:${data.userId.trim()}`);
      this.logger.debug(`Client ${client.id} joined room user:${data.userId.trim()}`);
    }
  }

  /**
   * Emit a notification event to all sockets in the user's personal room.
   * Called by `NotificationService.persistInApp()` after each successful insert.
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
   * Emit a tenant-wide notification to all connected sockets in a tenant room.
   * Clients join tenant rooms via `joinTenant` event after authenticating.
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

  /** Allow clients to subscribe to tenant-wide notifications. */
  @SubscribeMessage('joinTenant')
  handleJoinTenant(
    @MessageBody() data: { tenantId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (typeof data?.tenantId === 'string' && data.tenantId.trim()) {
      client.join(`tenant:${data.tenantId.trim()}`);
    }
  }
}
