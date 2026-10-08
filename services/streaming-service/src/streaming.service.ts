import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { MediasoupRouterService } from './mediasoup-router.service';

export interface StreamRoom {
  roomId: string;
  matchId: string;
  title: string;
  startedAt: Date;
  viewerCount: number;
  producerCount: number;
}

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);
  private activeStreams = new Map<string, StreamRoom>();

  constructor(private readonly mediasoup: MediasoupRouterService) {}

  async createStream(matchId: string, title: string): Promise<StreamRoom> {
    const roomId = `stream-${matchId}`;
    await this.mediasoup.createRoom(roomId);

    const streamRoom: StreamRoom = {
      roomId,
      matchId,
      title,
      startedAt: new Date(),
      viewerCount: 0,
      producerCount: 0,
    };

    this.activeStreams.set(roomId, streamRoom);
    this.logger.log(`Stream created: ${roomId} for match ${matchId}`);
    return streamRoom;
  }

  async endStream(matchId: string): Promise<void> {
    const roomId = `stream-${matchId}`;
    await this.mediasoup.closeRoom(roomId);
    this.activeStreams.delete(roomId);
    this.logger.log(`Stream ended: ${roomId}`);
  }

  getStream(roomId: string): StreamRoom | undefined {
    return this.activeStreams.get(roomId);
  }

  getActiveStreams(): StreamRoom[] {
    return Array.from(this.activeStreams.values());
  }

  updateViewerCount(roomId: string, delta: number): void {
    const stream = this.activeStreams.get(roomId);
    if (stream) {
      stream.viewerCount = Math.max(0, stream.viewerCount + delta);
    }
  }

  updateProducerCount(roomId: string, delta: number): void {
    const stream = this.activeStreams.get(roomId);
    if (stream) {
      stream.producerCount = Math.max(0, stream.producerCount + delta);
    }
  }
}
