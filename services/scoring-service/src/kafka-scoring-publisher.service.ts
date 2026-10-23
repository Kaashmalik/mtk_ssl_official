import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { env } from './env';

const BALL_EVENTS_TOPIC = 'ssl.scoring.ball-events';
const MATCH_EVENTS_TOPIC = 'ssl.match.events';

/**
 * Envelope published to `ssl.scoring.ball-events`.
 *
 * Two consumers depend on this topic:
 *  - ai-commentary-service reads the raw ball fields (top-level spread below
 *    matches its `BallEvent` interface: matchId, tenantId, inning, over, ball,
 *    runs, extras, wicket, batsmanId, bowlerId, timestamp). It ignores
 *    BALL_UNDONE corrections.
 *  - notification-service reads `event.type` + `event.data` (SIX_HIT /
 *    FOUR_HIT) for boundary alerts; BALL_UNDONE falls through silently.
 *
 * ENH-09-02: every envelope carries `scoringRevision` (the canonical commit
 * revision AFTER this event) and `ballId` (the stable match_balls identity), so
 * durable consumers can dedupe, order and retract deliveries. `timestamp` is
 * the persisted scoring_events commit time, never the service clock at publish.
 */
export interface ScoringBallEventPayload {
  type: 'BALL_RECORDED' | 'SIX_HIT' | 'FOUR_HIT' | 'WICKET' | 'BALL_UNDONE';
  data: Record<string, unknown>;

  eventId: string;
  matchId: string;
  tenantId: string;
  inning: number;
  over: number;
  ball: number;
  runs: number;
  extras?: { type: string; runs: number };
  wicket?: { type: string; playerOut: string; dismissedBy?: string };
  // Present on every recorded-delivery envelope; an undo correction may omit
  // them when the retracted ball row has no persisted attribution (pre-v2).
  batsmanId?: string;
  bowlerId?: string;
  batsmanName?: string;
  bowlerName?: string;
  sequenceNumber: number;
  timestamp: string;
  /** Canonical scoring revision after this event committed (ENH-09-02). */
  scoringRevision: number;
  /** Stable match_balls id; an undo envelope reuses it to retract the delivery. */
  ballId: string;
}

/**
 * Envelope published to `ssl.match.events`.
 *
 * Consumed by ai-commentary-service
 * (`CommentaryController.handleMatchEvent`), which switches on `type` and calls
 * `generateMatchIntro` / `generateMatchSummary`. Until this publisher existed
 * those two methods were unreachable — nothing ever emitted to this topic.
 *
 * `data` is keyed to exactly what the two prompts read:
 *   MatchStarted -> teamAName, teamBName, venueName, tournamentName
 *   MatchEnded   -> winnerName, result, motmName
 */
export type MatchEventType = 'MatchStarted' | 'MatchEnded';

export interface MatchEventPayload {
  type: MatchEventType;
  data: Record<string, unknown>;
  eventId: string;
  matchId: string;
  tenantId: string;
  timestamp: string;
}

@Injectable()
export class KafkaScoringPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaScoringPublisher.name);
  private readonly producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'scoring-service-producer',
      brokers: env.KAFKA_BROKERS.split(','),
      connectionTimeout: 5000,
      requestTimeout: 10000,
    });
    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
      maxInFlightRequests: 1,
      retry: { retries: 2 },
    });
    this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      // kafkajs re-attempts connection on the next send(); log so the outage
      // surface is visible while still degrading gracefully.
      this.logger.warn(
        `Kafka producer connect failed (will retry on next publish): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.producer.disconnect();
    } catch {
      // ignore shutdown errors
    }
  }

  async publishBallEvent(event: ScoringBallEventPayload): Promise<void> {
    // Throw on failed/unknown delivery so the durable worker retains this row.
    await this.producer.send({
      topic: BALL_EVENTS_TOPIC,
      acks: -1,
      timeout: 10000,
      messages: [
        {
          // Partition by match id to preserve in-order delivery per match.
          key: event.matchId,
          value: JSON.stringify(event),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': event.eventId,
          },
        },
      ],
    });
  }

  /**
   * Publishes a match lifecycle event consumed by the commentary service.
   *
   * Called by the outbox worker, not the scoring HTTP transaction. Failures must
   * propagate to its retry logic, never become a false delivery acknowledgement.
   */
  async publishMatchEvent(event: MatchEventPayload): Promise<void> {
    await this.producer.send({
      topic: MATCH_EVENTS_TOPIC,
      acks: -1,
      timeout: 10000,
      messages: [
        {
          key: event.matchId,
          value: JSON.stringify(event),
          headers: {
            'content-type': 'application/json',
            // Stable across retries/restarts; consumers must deduplicate effects.
            'idempotency-key': event.eventId,
          },
        },
      ],
    });
    this.logger.debug(`Published ${event.type} for match ${event.matchId}`);
  }
}
