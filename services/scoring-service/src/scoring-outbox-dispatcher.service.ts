import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { db } from '@mtk/database';
import { sql } from 'drizzle-orm';
import { KafkaScoringPublisher } from './kafka-scoring-publisher.service';
import { BALL_TOPIC, validateOutboxMessage } from './scoring-outbox';
import { env } from './env';

interface PendingMessage { id: string; tenantId: string; matchId: string; eventId: string; topic: string; payload: unknown }

@Injectable()
export class ScoringOutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScoringOutboxDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;
  private stopped = false;
  constructor(private readonly publisher: KafkaScoringPublisher) {}

  onModuleInit() {
    if (env.SCORING_OUTBOX_ENABLED !== 'true') {
      this.logger.warn('Scoring outbox dispatch paused; pending messages are retained');
      return;
    }
    this.timer = setInterval(() => { void this.drain().catch(() => this.logger.error('Scoring outbox database unavailable; retrying next tick')); }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  drain(): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.running) return this.running;
    this.running = this.runBatch().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async runBatch(): Promise<number> {
    let processed = 0;
    for (; processed < 25 && !this.stopped; processed++) if (!await this.dispatchOne()) break;
    return processed;
  }

  async dispatchOne(): Promise<boolean> {
    return db.transaction(async tx => {
      // Only lock the outbox row, never the match/actor/teams. The predecessor
      // predicate prevents SKIP LOCKED from overtaking the same match's head.
      const rows = await tx.execute(sql`SELECT candidate.id::text AS id,
        candidate.tenant_id AS "tenantId", candidate.match_id AS "matchId",
        candidate.event_id AS "eventId", candidate.topic, candidate.payload
        FROM public.scoring_outbox AS candidate
        WHERE candidate.delivered_at IS NULL AND candidate.next_attempt_at <= now()
AND candidate.attempts < 8
          AND NOT EXISTS (SELECT 1 FROM public.scoring_outbox AS predecessor
            WHERE predecessor.tenant_id = candidate.tenant_id AND predecessor.match_id = candidate.match_id
              AND predecessor.delivered_at IS NULL AND predecessor.id < candidate.id)
        ORDER BY candidate.id LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED`);
      const row = (rows as unknown as PendingMessage[])[0];
      if (!row) return false;
      let failure: string | null = null;
      let message: ReturnType<typeof validateOutboxMessage>;
      try { message = validateOutboxMessage(row.topic, row.payload, row.tenantId, row.matchId, row.eventId); }
      catch { failure = 'invalid_envelope'; }
      if (!failure) {
        try {
          if (message.topic === BALL_TOPIC) await this.publisher.publishBallEvent(message.payload);
          else await this.publisher.publishMatchEvent(message.payload);
        } catch { failure = 'broker_delivery_failed'; }
      }
      if (failure) {
        await tx.execute(sql`UPDATE public.scoring_outbox SET
          attempts = LEAST(attempts::bigint + 1, 2147483647)::integer,
          next_attempt_at = now() + CASE
WHEN attempts >= 5 THEN interval '3600 seconds'
WHEN attempts = 4 THEN interval '1800 seconds'
WHEN attempts = 3 THEN interval '600 seconds'
WHEN attempts = 2 THEN interval '120 seconds'
WHEN attempts = 1 THEN interval '30 seconds'
ELSE interval '5 seconds'
END,
          last_error = ${failure}
          WHERE id = ${row.id}::bigint AND tenant_id = ${row.tenantId}::uuid AND match_id = ${row.matchId}::uuid AND delivered_at IS NULL`);
        this.logger.warn(`Scoring outbox retry scheduled for row ${row.id} (${failure})`);
      } else {
        // A broker ACK followed by DB/process failure can redeliver this event.
        // Stable eventId is mandatory; consumers must deduplicate durable effects.
        await tx.execute(sql`UPDATE public.scoring_outbox SET delivered_at = now(), last_error = NULL,
          attempts = LEAST(attempts::bigint + 1, 2147483647)::integer
          WHERE id = ${row.id}::bigint AND tenant_id = ${row.tenantId}::uuid AND match_id = ${row.matchId}::uuid AND delivered_at IS NULL`);
      }
      return true;
    }, { isolationLevel: 'read committed' });
  }
}
