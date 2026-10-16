import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import { z } from 'zod';
import { CommentaryService, BallEvent, Commentary } from './commentary.service';
import { ConsumerIdempotencyService } from './consumer-idempotency.service';

/**
 * Consumes `ssl.scoring.ball-events` and `ssl.match.events` from scoring-service.
 *
 * Both handlers fan the generated text out to `ssl.commentary` so it reaches the
 * live feed via `CommentaryBridgeController`. The scoring outbox (Batch 63)
 * delivers each event at-least-once, so every handler claims the event identity
 * in `ConsumerIdempotencyService` before processing: duplicates are skipped, and
 * a failed generation releases its claim so a redelivery can reprocess instead
 * of being silently lost. Malformed payloads are rejected before any claim or
 * generation — an unknown shape can neither spend generation budget nor produce
 * a commentary row.
 */
@Controller()
export class CommentaryController {
  private readonly logger = new Logger(CommentaryController.name);

  constructor(
    private readonly commentaryService: CommentaryService,
    private readonly idempotency: ConsumerIdempotencyService,
  ) {}

  private static readonly ballEnvelope = z.object({
    matchId: z.string().uuid(),
    tenantId: z.string().uuid(),
    inning: z.number().int().min(1).max(3),
    over: z.number().int().min(0),
    ball: z.number().int().min(1).max(6),
    runs: z.number().int().min(0),
    // Names are snapshot best-effort by the producer and may be missing; the
    // service falls back to neutral commentary text for them.
    batsmanName: z.string().max(200).optional(),
    bowlerName: z.string().max(200).optional(),
  });

  private static readonly lifecycleEnvelope = z.object({
    type: z.enum(['MatchStarted', 'MatchEnded']),
    matchId: z.string().uuid(),
    tenantId: z.string().uuid(),
  });

  private static eventIdOf(source: unknown): string | null {
    if (typeof source !== 'object' || source === null) return null;
    const eventId = (source as { eventId?: unknown }).eventId;
    return typeof eventId === 'string' && eventId.length > 0 ? eventId : null;
  }

  private static headerString(header: unknown): string | null {
    if (typeof header === 'string' && header.length > 0) return header;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(header)) {
      const text = header.toString('utf8');
      return text.length > 0 ? text : null;
    }
    return null;
  }

  /**
   * Resolves the stable event identity used for deduplication. Preference order:
   * the producer's `idempotency-key` header (set by the scoring outbox worker),
   * the payload's `eventId`, then a deterministic composite of the delivery
   * coordinates. The composite is unique per accepted ball, so a redelivered
   * event still maps to the same identity.
   */
  private ballEventIdentity(event: BallEvent, context: KafkaContext): string | null {
    const fromHeader = CommentaryController.headerString(
      (context.getMessage() as { headers?: Record<string, unknown> } | undefined)?.headers?.['idempotency-key'],
    );
    if (fromHeader) return fromHeader;
    const fromEvent = CommentaryController.eventIdOf(event);
    if (fromEvent) return fromEvent;
    if (!CommentaryController.ballEnvelope.safeParse(event).success) return null;
    return `tenant:${event.tenantId}:match:${event.matchId}:innings:${event.inning}:${event.over}.${event.ball}`;
  }

  private lifecycleEventIdentity(event: { type: string; matchId: string }, context: KafkaContext): string | null {
    const fromHeader = CommentaryController.headerString(
      (context.getMessage() as { headers?: Record<string, unknown> } | undefined)?.headers?.['idempotency-key'],
    );
    if (fromHeader) return fromHeader;
    const fromEvent = CommentaryController.eventIdOf(event);
    if (fromEvent) return fromEvent;
    // The scoring outbox journals lifecycle events under this exact identity.
    if (CommentaryController.lifecycleEnvelope.safeParse(event).success) {
      return `${event.matchId}:${event.type}`;
    }
    return null;
  }

  /**
   * Claims `kind/eventId`; logs and returns null when this exact event was
   * already accepted. Unavailable deduplication processes the event (fail-open).
   */
  private async claimOnce(kind: string, eventId: string | null): Promise<boolean> {
    if (!eventId) return true;
    const claim = await this.idempotency.acquire(kind, eventId);
    if (claim === 'duplicate') {
      this.logger.log(`Skipping duplicate ${kind} event ${eventId}`);
      return false;
    }
    if (claim === 'unavailable') {
      this.logger.warn(`Deduplication unavailable for ${kind} event ${eventId}; processing without dedupe`);
    }
    return true;
  }

  @MessagePattern('ssl.scoring.ball-events')
  async handleBallEvent(@Payload() event: BallEvent, @Ctx() context: KafkaContext): Promise<Commentary | null> {
    const parsed = CommentaryController.ballEnvelope.safeParse(event);
    if (!parsed.success) {
      this.logger.warn('Ball event failed validation; ignoring without generation or claim');
      return null;
    }

    const eventId = this.ballEventIdentity(event, context);
    if (!eventId) {
      this.logger.warn(`Ball event for ${event.matchId} has no resolvable event identity; ignoring`);
      return null;
    }
    if (!(await this.claimOnce('ball', eventId))) return null;

    try {
      this.logger.debug(`Processing ball event: ${event.matchId} - ${event.over}.${event.ball}`);
      const commentary = await this.commentaryService.generateCommentary(event, eventId);
      this.logger.log(`Generated commentary for ${event.matchId}/${event.over}.${event.ball}`);
      return commentary;
    } catch (error) {
      // Processing failed: release the claim so a redelivered event reprocesses
      // instead of being suppressed as an (already-consumed) duplicate.
      await this.idempotency.release('ball', eventId);
      this.logger.error('Failed to generate commentary', error);
      return null;
    }
  }

  @MessagePattern('ssl.match.events')
  async handleMatchEvent(
    @Payload() event: { type: string; matchId: string; tenantId?: string; data: Record<string, unknown> },
    @Ctx() context: KafkaContext,
  ): Promise<string | null> {
    const parsed = CommentaryController.lifecycleEnvelope.safeParse(event);
    if (!parsed.success) {
      this.logger.warn(`Match event missing/invalid lifecycle fields (${event?.type ?? 'unknown'}); ignoring`);
      return null;
    }

    const kind = event.type === 'MatchStarted' ? 'intro' : 'summary';
    const eventId = this.lifecycleEventIdentity(event, context);
    if (!(await this.claimOnce(kind, eventId))) return null;

    try {
      if (event.type === 'MatchStarted') {
        const text = await this.commentaryService.generateMatchIntro(event.data);
        await this.commentaryService.publishMatchCommentary(event.matchId, text, 'intro', eventId);
        this.logger.log(`Generated match intro for ${event.matchId}`);
        return text;
      }

      const text = await this.commentaryService.generateMatchSummary(event.data);
      await this.commentaryService.publishMatchCommentary(event.matchId, text, 'summary', eventId);
      this.logger.log(`Generated match summary for ${event.matchId}`);
      return text;
    } catch (error) {
      // Release on failure so a redelivered lifecycle event retries generation
      // instead of being permanently suppressed by its claim.
      if (eventId) await this.idempotency.release(kind, eventId);
      this.logger.error(`Failed to handle ${event.type} for ${event.matchId}`, error);
      return null;
    }
  }
}
