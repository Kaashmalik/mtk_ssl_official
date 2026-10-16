import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import Redis from 'ioredis';
import { z } from 'zod';
import { env } from './env';
import { ScoringGateway } from './scoring.gateway';

interface CommentaryEvent {
  matchId: string;
  ballId: string;
  eventId?: string;
  english: string;
  urdu: string;
  punjabi: string;
  pashto: string;
  sindhi: string;
  timestamp: string;
  generatedBy: 'openai' | 'cached' | 'fallback';
}

const bridgeEnvelope = z.object({
  matchId: z.string().uuid(),
  english: z.string().max(4000),
  urdu: z.string().max(4000),
  generatedBy: z.enum(['openai', 'cached', 'fallback']),
});

/**
 * Forwards commentary from `ssl.commentary` to the publication-aware gateway.
 *
 * The commentary pipeline is at-least-once end to end: the scoring outbox
 * redelivers ball/lifecycle events, and a commentary-service consumer crash can
 * regenerate and republish the same text. This bridge therefore claims the
 * commentary identity (the producer's `idempotency-key` header, falling back to
 * the payload `eventId`) before forwarding, so viewers never see the same
 * commentary twice and the gateway's authorization path is not duplicated.
 *
 * Semantics mirror the commentary consumer: a duplicate identity is skipped,
 * Redis unavailability fails open (possible duplicate, surfaced in logs — claims
 * are never an authorization boundary; the gateway still rechecks publication
 * and league scope for every forward), and a forwarding failure releases the
 * claim so a redelivery can retry instead of being silently lost.
 */
@Controller()
export class CommentaryBridgeController {
  private readonly logger = new Logger(CommentaryBridgeController.name);
  private readonly redis: Redis | null;
  private redisUnhealthy = false;
  private readonly claimTtlSeconds = 86400;

  constructor(private readonly scoringGateway: ScoringGateway) {
    try {
      const redisUrl = new URL(env.REDIS_URL);
      this.redis = new Redis({
        host: env.REDIS_HOST ?? redisUrl.hostname,
        port: env.REDIS_PORT ?? Number(redisUrl.port || '6379'),
        maxRetriesPerRequest: 2,
      });
      this.redis.on('error', (err) => {
        this.logger.warn(`Redis connection error; bridge deduplication unavailable (${err.message})`);
        this.redisUnhealthy = true;
      });
      this.redis.on('ready', () => {
        this.redisUnhealthy = false;
      });
    } catch (err) {
      this.logger.warn(
        `Bridge deduplication unavailable; failures forward without dedupe (${err instanceof Error ? err.message : String(err)})`,
      );
      this.redis = null;
    }
  }

  private commentaryIdentity(data: CommentaryEvent, context: KafkaContext): string | null {
    const header = context.getMessage()?.headers?.['idempotency-key'];
    if (typeof header === 'string' && header.length > 0) return header;
    if (typeof data.eventId === 'string' && data.eventId.length > 0) return data.eventId;
    return null;
  }

  @EventPattern('ssl.commentary')
  async handleCommentary(@Payload() data: CommentaryEvent, @Ctx() context: KafkaContext): Promise<void> {
    if (!data?.matchId) {
      this.logger.warn('Commentary event missing matchId');
      return;
    }
    if (!bridgeEnvelope.safeParse(data).success) {
      this.logger.warn('Commentary event failed validation; not forwarding');
      return;
    }

    const identity = this.commentaryIdentity(data, context);
    if (identity && this.redis && !this.redisUnhealthy) {
      try {
        const claimed = await this.redis.set(
          `forwarded-commentary:${identity}`,
          '1',
          'EX',
          this.claimTtlSeconds,
          'NX',
        );
        if (!claimed) {
          this.logger.log(`Skipping duplicate commentary ${identity}`);
          return;
        }
      } catch (err) {
        // Fail open: a dedupe outage must not drop the live feed. The gateway
        // still authorizes every forward against publication state.
        this.logger.warn(
          `Bridge claim failed for commentary ${identity}; forwarding without dedupe`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    try {
      await this.scoringGateway.broadcastCommentary({ ...data });
    } catch (error) {
      // Release the claim so a redelivered commentary retries the forward.
      if (identity && this.redis && !this.redisUnhealthy) {
        await this.redis.del(`forwarded-commentary:${identity}`).catch(() => undefined);
      }
      this.logger.error(`Failed to forward commentary for ${data.matchId}`, error);
    }
  }
}
