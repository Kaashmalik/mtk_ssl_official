import { db } from '@mtk/database';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ScoringOutboxDispatcher } from './scoring-outbox-dispatcher.service';
import { KafkaScoringPublisher } from './kafka-scoring-publisher.service';
import { BALL_TOPIC, MATCH_TOPIC, validateOutboxMessage } from './scoring-outbox';
import { env } from './env';

jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));
jest.mock('@mtk/database', () => ({ ...jest.requireActual('@mtk/database'), db: { transaction: jest.fn() } }));
jest.mock('./env', () => ({ env: { SCORING_OUTBOX_ENABLED: 'false' } }));
const dialect = new PgDialect();
const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';
const EVENT = '00000000-0000-4000-8000-000000000003';
function pending() {
  return { id: '42', tenantId: TENANT, matchId: MATCH, eventId: EVENT, topic: BALL_TOPIC,
    payload: { eventId: EVENT, tenantId: TENANT, matchId: MATCH, timestamp: '2026-10-16T12:00:00Z', data: { tenantId: TENANT, matchId: MATCH, inningsId: EVENT },
      type: 'FOUR_HIT', inning: 1, over: 0, ball: 1, sequenceNumber: 1, runs: 4, batsmanId: TENANT, bowlerId: MATCH } };
}

describe('Durable scoring outbox worker (transaction/transport doubles, not real PostgreSQL)', () => {
  let worker: ScoringOutboxDispatcher;
  let tx: { execute: jest.Mock };
  const publisher = { publishBallEvent: jest.fn(), publishMatchEvent: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    env.SCORING_OUTBOX_ENABLED = 'false';
    tx = { execute: jest.fn().mockResolvedValue([]) };
    publisher.publishBallEvent.mockResolvedValue(undefined);
    publisher.publishMatchEvent.mockResolvedValue(undefined);
    (db.transaction as jest.Mock).mockImplementation(async callback => callback(tx));
    worker = new ScoringOutboxDispatcher(publisher as unknown as KafkaScoringPublisher);
  });
  afterEach(() => jest.useRealTimers());
  it('locks only an available match-stream head without overtaking a locked predecessor', async () => {
    expect(await worker.dispatchOne()).toBe(false);
    const query = dialect.sqlToQuery(tx.execute.mock.calls[0][0]);
    expect(query.sql).toContain('FOR UPDATE OF candidate SKIP LOCKED');
    expect(query.sql).toContain('predecessor.tenant_id = candidate.tenant_id');
    expect(query.sql).toContain('predecessor.match_id = candidate.match_id');
    expect(query.sql).toContain('predecessor.delivered_at IS NULL AND predecessor.id < candidate.id');
    expect(query.sql).toContain('candidate.next_attempt_at <= now()');
    expect(query.sql).toContain('ORDER BY candidate.id LIMIT 1');
    expect(query.sql).not.toContain('public.matches');
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'read committed' });
  });
  it('marks delivered only after the broker acknowledgement with all resource predicates', async () => {
    const row = pending(); tx.execute.mockResolvedValueOnce([row]);
    publisher.publishBallEvent.mockImplementation(async () => expect(tx.execute).toHaveBeenCalledTimes(1));
    expect(await worker.dispatchOne()).toBe(true);
    expect(publisher.publishBallEvent).toHaveBeenCalledWith(row.payload);
    const update = dialect.sqlToQuery(tx.execute.mock.calls[1][0]);
    expect(update.sql).toContain('delivered_at = now()');
    expect(update.params).toEqual(['42', TENANT, MATCH]);
    expect(update.sql).toContain('delivered_at IS NULL');
  });
  it('dispatches lifecycle snapshots without rebuilding mutable names or result metadata', async () => {
    const row = { ...pending(), topic: MATCH_TOPIC, eventId: `${MATCH}:MatchEnded`, payload: {
      eventId: `${MATCH}:MatchEnded`, tenantId: TENANT, matchId: MATCH, timestamp: '2026-10-16T12:00:00Z', type: 'MatchEnded', data: { result: 'Won' } } };
    tx.execute.mockResolvedValueOnce([row]);
    await worker.dispatchOne();
    expect(publisher.publishMatchEvent).toHaveBeenCalledWith(row.payload);
    expect(publisher.publishBallEvent).not.toHaveBeenCalled();
  });
  it('retains broker failures with capped backoff and sanitized error code', async () => {
    tx.execute.mockResolvedValueOnce([pending()]);
    publisher.publishBallEvent.mockRejectedValue(new Error('credentials: secret-value'));
    await expect(worker.dispatchOne()).resolves.toBe(true);
    const update = dialect.sqlToQuery(tx.execute.mock.calls[1][0]);
    expect(update.params).toEqual(['broker_delivery_failed', '42', TENANT, MATCH]);
    expect(update.sql).toContain('LEAST(300, POWER(2, LEAST(attempts, 9)))');
    expect(update.sql).not.toContain('delivered_at = now()');
    expect(JSON.stringify(update)).not.toContain('secret-value');
    expect(update.sql).not.toContain('DELETE');
  });
  it.each(['tenantId', 'matchId', 'eventId'])('retains mismatched envelope %s without sending', async key => {
    const row = pending(); row.payload[key] = MATCH === row.payload[key] ? TENANT : MATCH;
    tx.execute.mockResolvedValueOnce([row]);
    await worker.dispatchOne();
    expect(publisher.publishBallEvent).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(tx.execute.mock.calls[1][0]).params[0]).toBe('invalid_envelope');
  });
  it('retains unsupported topics and malformed payloads instead of executing/fetching them', async () => {
    tx.execute.mockResolvedValueOnce([{ ...pending(), topic: 'https://untrusted.invalid' }]);
    await worker.dispatchOne();
    expect(publisher.publishBallEvent).not.toHaveBeenCalled();
    expect(publisher.publishMatchEvent).not.toHaveBeenCalled();
  });
  it('rejects forged nested delivery scope even when the top-level envelope matches', async () => {
    const row = pending(); row.payload.data.tenantId = MATCH;
    tx.execute.mockResolvedValueOnce([row]);
    await worker.dispatchOne();
    expect(publisher.publishBallEvent).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(tx.execute.mock.calls[1][0]).params[0]).toBe('invalid_envelope');
  });
  it('rejects lifecycle identity that is not the deterministic match/type key', () => {
    const payload = { ...pending().payload, type: 'MatchStarted' };
    expect(() => validateOutboxMessage(MATCH_TOPIC, payload, TENANT, MATCH, EVENT)).toThrow('Lifecycle event identity');
  });
  it('keeps the same stable event identity when acknowledgement persistence fails and a fresh worker retries', async () => {
    const row = pending();
    tx.execute.mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('Commit/storage interrupted'));
    await expect(worker.dispatchOne()).rejects.toThrow('interrupted');
    const replacement = new ScoringOutboxDispatcher(publisher as unknown as KafkaScoringPublisher);
    tx.execute.mockResolvedValueOnce([row]);
    await replacement.dispatchOne();
    expect(publisher.publishBallEvent.mock.calls.map(([payload]) => payload.eventId)).toEqual([EVENT, EVENT]);
  });
  it('does not pretend an unavailable database is an empty queue', async () => {
    tx.execute.mockRejectedValue(new Error('Database unavailable'));
    await expect(worker.dispatchOne()).rejects.toThrow('Database unavailable');
  });
  it('bounds a drain batch and prevents overlapping drains in the same process', async () => {
    const dispatch = jest.spyOn(worker, 'dispatchOne').mockResolvedValue(true);
    const first = worker.drain();
    expect(worker.drain()).toBe(first);
    expect(await first).toBe(25);
    expect(dispatch).toHaveBeenCalledTimes(25);
  });
  it('pauses by default without touching or deleting retained messages', () => {
    jest.useFakeTimers();
    worker.onModuleInit(); jest.advanceTimersByTime(5000);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('starts an explicitly enabled worker and stops cleanly without new work after shutdown', async () => {
    jest.useFakeTimers(); env.SCORING_OUTBOX_ENABLED = 'true';
    worker.onModuleInit(); await jest.advanceTimersByTimeAsync(1000);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy(); await jest.advanceTimersByTimeAsync(5000);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(await worker.drain()).toBe(0);
  });
  it.each([null, {}, { ...pending().payload, sequenceNumber: 0 }, { ...pending().payload, type: 'OTHER' }])('rejects malformed delivery payload %s', payload => {
    expect(() => validateOutboxMessage(BALL_TOPIC, payload, TENANT, MATCH, EVENT)).toThrow();
  });
});
