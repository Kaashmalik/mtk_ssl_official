import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type ClaimResult = 'claimed' | 'duplicate' | 'unavailable';

/**
 * Best-effort deduplication for Kafka consumers (SCORE-12 consumer half).
 *
 * The scoring outbox guarantees at-least-once delivery: a broker acknowledgement
 * can be followed by a dispatcher crash before the row is marked delivered, and
 * a consumer crash can occur between processing and the offset commit. In both
 * cases the same logical event is delivered again, and without deduplication the
 * commentary service would regenerate text, double-publish to `ssl.commentary`
 * and duplicate the live feed for viewers.
 *
 * Semantics, chosen to be honest about the trade-offs:
 * - `acquire` claims an event id with SET NX EX BEFORE processing. A duplicate
 *   claim means the identical event was already accepted, so the caller skips it.
 * - `release` is called when processing FAILS, deleting the claim so a
 *   redelivered event can be reprocessed instead of being silently lost.
 * - A hard crash between claim and offset commit can still suppress one
 *   regeneration until the TTL expires; the TTL bounds that window (24h).
 * - Redis unavailability returns `unavailable` and the caller processes the
 *   event anyway (fail-open): duplicates are possible and surfaced in logs, but
 *   an outage must never silently drop live commentary. Claims are only a cache,
 *   never an authorization boundary.
 */
@Injectable()
export class ConsumerIdempotencyService implements OnModuleDestroy {
  private readonly logger = new Logger(ConsumerIdempotencyService.name);
  private redis: Redis | null = null;
  private redisUnhealthy = false;
  private readonly claimTtlSeconds = 86400;

  constructor(configService: ConfigService) {
    const redisUrl = configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
      this.redis.on('error', (err) => {
        this.logger.warn(`Redis connection error; consumer deduplication is unavailable (${err.message})`);
        this.redisUnhealthy = true;
      });
      this.redis.on('ready', () => {
        this.redisUnhealthy = false;
      });
    } else {
      this.logger.warn('REDIS_URL is not configured; consumer deduplication is unavailable');
      this.redisUnhealthy = true;
    }
  }

  async acquire(kind: string, eventId: string): Promise<ClaimResult> {
    if (!this.redis || this.redisUnhealthy) return 'unavailable';
    try {
      const created = await this.redis.set(
        `consumed-commentary:${kind}:${eventId}`,
        '1',
        'EX',
        this.claimTtlSeconds,
        'NX',
      );
      return created ? 'claimed' : 'duplicate';
    } catch (err) {
      this.logger.warn(
        `Deduplication claim failed for ${kind}/${eventId}; processing without dedupe`,
        err instanceof Error ? err.message : String(err),
      );
      return 'unavailable';
    }
  }

  async release(kind: string, eventId: string): Promise<void> {
    if (!this.redis || this.redisUnhealthy) return;
    try {
      await this.redis.del(`consumed-commentary:${kind}:${eventId}`);
    } catch (err) {
      // The TTL expires the abandoned claim; redelivery may be skipped once.
      this.logger.warn(
        `Failed to release deduplication claim for ${kind}/${eventId}; TTL will expire it`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // ignore shutdown errors
      }
    }
  }
}
