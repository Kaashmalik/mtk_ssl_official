import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import { CommentaryService, BallEvent, Commentary } from './commentary.service';

/**
 * Consumes `ssl.match.events` from scoring-service.
 *
 * Both handlers now fan the generated text out to `ssl.commentary` so it reaches
 * the live feed via `CommentaryBridgeController`. Previously the text was only
 * *returned* to Kafka, where nothing consumed it — so `generateMatchIntro` /
 * `generateMatchSummary` were unreachable in practice: no producer emitted to
 * this topic, and even with a producer the result would have been discarded.
 */
@Controller()
export class CommentaryController {
  private readonly logger = new Logger(CommentaryController.name);

  constructor(private readonly commentaryService: CommentaryService) {}

  @MessagePattern('ssl.scoring.ball-events')
  async handleBallEvent(@Payload() event: BallEvent, @Ctx() _context: KafkaContext): Promise<Commentary | null> {
    this.logger.debug(`Processing ball event: ${event.matchId} - ${event.over}.${event.ball}`);
    
    try {
      const commentary = await this.commentaryService.generateCommentary(event);
      
      this.logger.log(`Generated commentary for ${event.matchId}/${event.over}.${event.ball}`);
      
      return commentary;
    } catch (error) {
      this.logger.error('Failed to generate commentary', error);
      return null;
    }
  }

  @MessagePattern('ssl.match.events')
  async handleMatchEvent(@Payload() event: { type: string; matchId: string; data: Record<string, unknown> }) {
    const matchId = event?.matchId;
    if (!matchId) {
      this.logger.warn('Match event missing matchId; ignoring');
      return null;
    }

    try {
      if (event.type === 'MatchStarted') {
        const text = await this.commentaryService.generateMatchIntro(event.data);
        await this.commentaryService.publishMatchCommentary(matchId, text, 'intro');
        this.logger.log(`Generated match intro for ${matchId}`);
        return text;
      }

      if (event.type === 'MatchEnded') {
        const text = await this.commentaryService.generateMatchSummary(event.data);
        await this.commentaryService.publishMatchCommentary(matchId, text, 'summary');
        this.logger.log(`Generated match summary for ${matchId}`);
        return text;
      }

      return null;
    } catch (error) {
      // Never let a failed generation kill the consumer loop; the next event
      // should still be processed.
      this.logger.error(`Failed to handle ${event?.type} for ${matchId}`, error);
      return null;
    }
  }
}
