import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { MediasoupRouterService } from './mediasoup-router.service';
import * as mediasoup from 'mediasoup';

interface ClientData {
  roomId: string;
  transportIds: string[];
  producerIds: string[];
}

@WebSocketGateway({ namespace: 'streaming', cors: { origin: true } })
export class StreamingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(StreamingGateway.name);
  private clients = new Map<string, ClientData>();

  constructor(private readonly mediasoup: MediasoupRouterService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const data = this.clients.get(client.id);
    if (data) {
      // Cleanup logic for transports/producers will be handled by mediasoup close events
      this.clients.delete(client.id);
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @MessageBody() body: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId } = body;
    await this.mediasoup.createRoom(roomId);
    client.join(roomId);
    this.clients.set(client.id, { roomId, transportIds: [], producerIds: [] });
    this.logger.log(`Client ${client.id} joined room ${roomId}`);

    const router = this.mediasoup.getRouter(roomId)!;
    client.emit('router-capabilities', { rtpCapabilities: router.rtpCapabilities });
  }

  @SubscribeMessage('create-transport')
  async handleCreateTransport(
    @MessageBody() body: { direction: 'send' | 'recv' },
    @ConnectedSocket() client: Socket,
  ) {
    const data = this.clients.get(client.id);
    if (!data) return;

    const transport = await this.mediasoup.createWebRtcTransport(data.roomId);
    data.transportIds.push(transport.id);

    client.emit('transport-created', {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  }

  @SubscribeMessage('connect-transport')
  async handleConnectTransport(
    @MessageBody() body: { transportId: string; dtlsParameters: mediasoup.types.DtlsParameters },
    @ConnectedSocket() client: Socket,
  ) {
    const data = this.clients.get(client.id);
    if (!data) return;

    const room = this.mediasoup.getRoom(data.roomId);
    const transport = room?.transports.get(body.transportId);
    if (!transport) return;

    await transport.connect({ dtlsParameters: body.dtlsParameters });
    client.emit('transport-connected', { transportId: body.transportId });
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @MessageBody() body: { transportId: string; kind: 'audio' | 'video'; rtpParameters: mediasoup.types.RtpParameters },
    @ConnectedSocket() client: Socket,
  ) {
    const data = this.clients.get(client.id);
    if (!data) return;

    const producer = await this.mediasoup.createProducer(
      data.roomId,
      body.transportId,
      body.kind,
      body.rtpParameters,
    );
    data.producerIds.push(producer.id);

    // Notify other clients in room
    client.to(data.roomId).emit('new-producer', { producerId: producer.id });
    client.emit('producer-created', { producerId: producer.id });
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @MessageBody() body: { transportId: string; producerId: string; rtpCapabilities: mediasoup.types.RtpCapabilities },
    @ConnectedSocket() client: Socket,
  ) {
    const data = this.clients.get(client.id);
    if (!data) return;

    const consumer = await this.mediasoup.createConsumer(
      data.roomId,
      body.transportId,
      body.producerId,
      body.rtpCapabilities,
    );

    if (!consumer) {
      client.emit('consume-error', { error: 'Cannot consume this producer' });
      return;
    }

    await consumer.resume();
    client.emit('consumer-created', {
      id: consumer.id,
      producerId: body.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const data = this.clients.get(client.id);
    if (data) {
      client.leave(data.roomId);
      this.clients.delete(client.id);
      this.logger.log(`Client ${client.id} left room ${data.roomId}`);
    }
  }
}
