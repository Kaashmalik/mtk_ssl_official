import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ScoringGateway } from './scoring.gateway';

interface CommentaryEvent {
  matchId: string;
  ballId: string;
  english: string;
  urdu: string;
  punjabi: string;
  pashto: string;
  sindhi: string;
  timestamp: string;
  generatedBy: 'openai' | 'cached' | 'fallback';
}

@Controller()
export class CommentaryBridgeController {
  private readonly logger = new Logger(CommentaryBridgeController.name);

  constructor(private readonly scoringGateway: ScoringGateway) {}

  @EventPattern('ssl.commentary')
  handleCommentary(@Payload() data: CommentaryEvent) {
    if (!data?.matchId) {
      this.logger.warn('Commentary event missing matchId');
      return;
    }
    this.scoringGateway.server
      ?.to(`match:${data.matchId}`)
      .emit('commentary-update', data);
  }
}
