import { scoringOutbox } from '@mtk/database';
import { z } from 'zod';
import type { ScoringTransaction } from './scoring-write-access';
import type { MatchEventPayload, ScoringBallEventPayload } from './kafka-scoring-publisher.service';

export const BALL_TOPIC = 'ssl.scoring.ball-events';
export const MATCH_TOPIC = 'ssl.match.events';
export type OutboxMessage = { topic: typeof BALL_TOPIC; payload: ScoringBallEventPayload }
  | { topic: typeof MATCH_TOPIC; payload: MatchEventPayload };

const envelope = z.object({ tenantId: z.string().uuid(), matchId: z.string().uuid(),
  eventId: z.string().min(1).max(200), timestamp: z.string().datetime({ offset: true }), data: z.record(z.unknown()) });
export function validateOutboxMessage(topic: string, input: unknown, tenantId: string, matchId: string, eventId: string): OutboxMessage {
  const parsed = envelope.parse(input);
  if (parsed.tenantId !== tenantId || parsed.matchId !== matchId || parsed.eventId !== eventId) throw new Error('Outbox envelope mismatch');
  if (topic === BALL_TOPIC) {
    z.object({ type: z.enum(['BALL_RECORDED', 'SIX_HIT', 'FOUR_HIT', 'WICKET']),
      sequenceNumber: z.number().int().positive(), inning: z.number().int().min(1).max(3),
      over: z.number().int().nonnegative(), ball: z.number().int().min(1).max(6),
      runs: z.number().int().nonnegative(), batsmanId: z.string().uuid(), bowlerId: z.string().uuid() }).parse(input);
    z.string().uuid().parse(eventId);
    if (parsed.data.tenantId !== tenantId || parsed.data.matchId !== matchId) throw new Error('Nested outbox scope mismatch');
    z.string().uuid().parse(parsed.data.inningsId);
  } else if (topic === MATCH_TOPIC) {
    const lifecycle = z.object({ type: z.enum(['MatchStarted', 'MatchEnded']) }).parse(input);
    if (eventId !== `${matchId}:${lifecycle.type}`) throw new Error('Lifecycle event identity mismatch');
  } else throw new Error('Unsupported outbox topic');
  return { topic, payload: input } as OutboxMessage;
}

/** Called only inside the score/result transaction, before commit. No Kafka here. */
export async function enqueueScoringMessage(tx: ScoringTransaction, message: OutboxMessage): Promise<void> {
  const { payload, topic } = message;
  validateOutboxMessage(topic, payload, payload.tenantId, payload.matchId, payload.eventId);
  const [row] = await tx.insert(scoringOutbox).values({ topic, tenantId: payload.tenantId,
    matchId: payload.matchId, eventId: payload.eventId, payload }).returning({ id: scoringOutbox.id });
  if (!row) throw new Error('Outbox insert returned no row');
}
