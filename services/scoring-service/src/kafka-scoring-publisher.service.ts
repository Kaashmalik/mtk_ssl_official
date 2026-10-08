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
 *    runs, extras, wicket, batsmanId, bowlerId, timestamp).
 *  - notification-service reads `event.type` + `event.data` (SIX_HIT /
 *    FOUR_HIT) for boundary alerts.
 */
export interface ScoringBallEventPayload {
  type: 'BALL_RECORDED' | 'SIX_HIT' | 'FOUR_HIT' | 'WICKET';
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
  batsmanId: string;
  bowlerId: string;
  batsmanName?: string;
  bowlerName?: string;
  sequenceNumber: number;
  timestamp: string;
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
    });
    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
      maxInFlightRequests: 1,
      retry: { retries: 5 },
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
    try {
      await this.producer.send({
        topic: BALL_EVENTS_TOPIC,
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
    } catch (err) {
      this.logger.warn(
        `Failed to publish ball event ${event.eventId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Publishes a match lifecycle event consumed by the commentary service.
   *
   * Fails soft for the same reason `publishBallEvent` does: Kafka being down must
   * never roll back a committed score. A dropped event means a missing intro or
   * summary, which is recoverable, whereas a 500 here would report a scoring
   * failure that did not happen.
   */
  async publishMatchEvent(event: MatchEventPayload): Promise<void> {
    try {
      await this.producer.send({
        topic: MATCH_EVENTS_TOPIC,
        messages: [
          {
            key: event.matchId,
            value: JSON.stringify(event),
            headers: {
              'content-type': 'application/json',
              // Deterministic per (match, event type) so a redelivery of the same
              // logical event carries the same key and can be de-duplicated by a
              // consumer.
              'idempotency-key': `${event.matchId}:${event.type}`,
            },
          },
        ],
      });
      this.logger.debug(`Published ${event.type} for match ${event.matchId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to publish ${event.type} for match ${event.matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}