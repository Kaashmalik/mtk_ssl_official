import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { env } from './env';

interface WorkerResource {
  worker: mediasoup.types.Worker;
  routers: Map<string, mediasoup.types.Router>;
  transports: Map<string, mediasoup.types.WebRtcTransport>;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;
}

@Injectable()
export class MediasoupRouterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediasoupRouterService.name);
  private workers: mediasoup.types.Worker[] = [];
  private nextWorkerIdx = 0;
  private rooms = new Map<string, WorkerResource>();

  async onModuleInit() {
    const numWorkers = require('os').cpus().length;
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: env.NODE_ENV === 'production' ? 'warn' : 'debug',
        rtcMinPort: env.RTC_MIN_PORT,
        rtcMaxPort: env.RTC_MAX_PORT,
      });
      worker.on('died', () => {
        this.logger.error(`Worker ${i} died, exiting process`);
        process.exit(1);
      });
      this.workers.push(worker);
    }
    this.logger.log(`${numWorkers} mediasoup workers ready`);
  }

  async onModuleDestroy() {
    for (const worker of this.workers) {
      worker.close();
    }
  }

  private getNextWorker(): mediasoup.types.Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  async createRoom(roomId: string): Promise<mediasoup.types.Router> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!.routers.get('main')!;
    }

    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: [
        { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
        { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
        { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f' } },
      ],
    });

    const resource: WorkerResource = {
      worker,
      routers: new Map([['main', router]]),
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };

    this.rooms.set(roomId, resource);
    this.logger.log(`Room ${roomId} created with router ${router.id}`);
    return router;
  }

  async closeRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const consumer of room.consumers.values()) consumer.close();
    for (const producer of room.producers.values()) producer.close();
    for (const transport of room.transports.values()) transport.close();
    for (const router of room.routers.values()) router.close();

    this.rooms.delete(roomId);
    this.logger.log(`Room ${roomId} closed`);
  }

  getRouter(roomId: string): mediasoup.types.Router | undefined {
    return this.rooms.get(roomId)?.routers.get('main');
  }

  getRoom(roomId: string): WorkerResource | undefined {
    return this.rooms.get(roomId);
  }

  async createWebRtcTransport(roomId: string): Promise<mediasoup.types.WebRtcTransport> {
    const room = this.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const router = room.routers.get('main')!;
    const transport = await router.createWebRtcTransport({
      listenIps: [
        {
          ip: env.MEDIASOUP_LISTEN_IP,
          announcedIp: env.MEDIASOUP_ANNOUNCED_IP || env.MEDIASOUP_LISTEN_IP,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') transport.close();
    });

    room.transports.set(transport.id, transport);
    return transport;
  }

  async createProducer(roomId: string, transportId: string, kind: 'audio' | 'video', rtpParameters: mediasoup.types.RtpParameters): Promise<mediasoup.types.Producer> {
    const room = this.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const transport = room.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters });
    room.producers.set(producer.id, producer);
    this.logger.log(`Producer ${producer.id} created in room ${roomId}`);
    return producer;
  }

  async createConsumer(roomId: string, transportId: string, producerId: string, rtpCapabilities: mediasoup.types.RtpCapabilities): Promise<mediasoup.types.Consumer | null> {
    const room = this.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const router = room.routers.get('main')!;
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return null;
    }

    const transport = room.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    room.consumers.set(consumer.id, consumer);
    this.logger.log(`Consumer ${consumer.id} created for producer ${producerId}`);
    return consumer;
  }
}
