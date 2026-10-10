import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { matchBalls, matchInnings, scoringEvents, scorecardProjections } from '@mtk/database';
import { ScoringService, BallEvent } from './scoring.service';
import { KafkaScoringPublisher } from './kafka-scoring-publisher.service';

const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';
const INNINGS = '00000000-0000-4000-8000-000000000003';
const BATTER = '00000000-0000-4000-8000-000000000004';
const BOWLER = '00000000-0000-4000-8000-000000000005';
const dialect = new PgDialect();
const mockRedis = { del: jest.fn().mockResolvedValue(1) };
let mockTx: ReturnType<typeof createTransaction>;
let sequence = 10;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));
// Keep real schema/SQL definitions, without initializing any network client.
jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));
jest.mock('@mtk/database', () => ({
  ...jest.requireActual('@mtk/database'),
  db: { transaction: jest.fn(async (fn) => {
    mockTx.inTransaction = true;
    try { return await fn(mockTx); }
    finally { mockTx.inTransaction = false; }
  }) },
}));

function uuid() {
  sequence++;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

// Test adapter evaluates real Drizzle expressions against an in-memory fixture.
// It proves service accounting/transaction boundaries, not PostgreSQL lock behavior.
function createTransaction() {
  const state = {
    innings: {
      id: INNINGS, tenantId: TENANT, matchId: MATCH, teamId: TENANT,
      inningsNumber: 1, status: 'in_progress', totalRuns: 0, totalWickets: 0,
      totalBalls: 0, extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0,
    },
    match: { id: MATCH, tenantId: TENANT, status: 'live', startDate: new Date() },
    balls: [] as Array<Record<string, any>>,
    events: [] as Array<Record<string, any>>,
    projection: {} as Record<string, any>,
  };
  const tx = {
    state,
    inTransaction: false,
    execute: jest.fn().mockResolvedValue([]),
    query: {
      matches: { findFirst: jest.fn(async () => ({ ...state.match })) },
      matchInnings: { findFirst: jest.fn(async () => ({ ...state.innings })) },
      players: { findFirst: jest.fn(async () => ({ name: 'Player' })) },
      scorecardProjections: { findFirst: jest.fn(async () => state.projection) },
      matchBalls: { findFirst: jest.fn(async ({ where }) => {
        const query = dialect.sqlToQuery(where);
        if (query.sql.includes('"match_balls"."id" =')) {
          return state.balls.find((ball) => query.params.includes(ball.id));
        }
        return [...state.balls].sort((a, b) => b.ballSequence - a.ballSequence)[0];
      }) },
      scoringEvents: { findFirst: jest.fn(async ({ where }) => {
        const query = dialect.sqlToQuery(where);
        const key = query.sql.includes('client_op_id') ? 'client_op_id' : 'ball_id';
        return state.events.find((event) => event.eventType === 'ball_recorded' &&
          event.payload[key] != null && query.params.includes(event.payload[key]));
      }) },
    },
    select: jest.fn(() => ({ from: () => ({ where: async () => [{
      // postgres aggregates may be strings: allocation must not concatenate.
      seq: String(Math.max(0, ...state.events.map((event) => event.sequenceNumber))),
    }] }) })),
    insert: jest.fn((table) => ({ values: (values: Record<string, any>) => {
      const row = { ...values, id: uuid(), createdAt: new Date() };
      if (table === matchBalls) state.balls.push(row);
      if (table === scoringEvents) state.events.push(row);
      if (table === scorecardProjections) state.projection = row;
      return { returning: async () => [row] };
    } })),
    update: jest.fn((table) => ({ set: (values: Record<string, any>) => ({ where: async () => {
      if (table === matchInnings) {
        for (const [key, value] of Object.entries(values)) {
          if (value instanceof SQL) {
            const amount = Number(dialect.sqlToQuery(value).params[0]);
            state.innings[key] += amount;
          } else state.innings[key] = value;
        }
      } else if (table === scorecardProjections) state.projection = { ...values };
    } }) })),
    delete: jest.fn(() => ({ where: async (where: SQL) => {
      const query = dialect.sqlToQuery(where);
      state.balls = state.balls.filter((ball) => !query.params.includes(ball.id));
    } })),
  };
  return tx;
}

function ball(input: Partial<BallEvent> = {}): BallEvent {
  return {
    matchId: MATCH, inningsId: INNINGS, over: 0, ball: 1, runs: 0,
    batsmanId: BATTER, bowlerId: BOWLER, timestamp: new Date(),
    clientOpId: uuid(), ...input,
  };
}

describe('Canonical delivery record, replay and undo', () => {
  let service: ScoringService;
  const publisher = {
    publishBallEvent: jest.fn().mockResolvedValue(undefined),
    publishMatchEvent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTx = createTransaction();
    mockRedis.del.mockImplementation(async () => {
      expect(mockTx.inTransaction).toBe(false);
      return 1;
    });
    service = new ScoringService(publisher as unknown as KafkaScoringPublisher);
  });

  it.each([
    { extras: undefined, runs: 4, total: 4, extraRuns: 0, legalBalls: 1 },
    { extras: { type: 'wide' as const, runs: 5 }, runs: 0, total: 5, extraRuns: 5, legalBalls: 0 },
    { extras: { type: 'noball' as const, runs: 1 }, runs: 4, total: 5, extraRuns: 1, legalBalls: 0 },
    { extras: { type: 'bye' as const, runs: 4 }, runs: 0, total: 4, extraRuns: 4, legalBalls: 1 },
    { extras: { type: 'legbye' as const, runs: 2 }, runs: 0, total: 2, extraRuns: 2, legalBalls: 1 },
  ])('records and exactly reverses $extras', async ({ extras, runs, total, extraRuns, legalBalls }) => {
    const accepted = await service.recordBall(TENANT, ball({ runs, extras }));
    expect(accepted.scorecard.totalRuns).toBe(total);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: total, totalBalls: legalBalls, extras: extraRuns });
    expect(mockTx.state.balls[0].runs).toBe(total);
    expect(mockTx.state.events[0]).toMatchObject({ eventVersion: 2, sequenceNumber: 1 });

    await service.undoBall(TENANT, MATCH, accepted.ballId);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: 0, totalBalls: 0, totalWickets: 0,
      extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0 });
    expect(mockTx.state.projection).toMatchObject({ totalRuns: 0, totalExtras: 0, byes: 0, legByes: 0 });
    expect(mockTx.state.events[1]).toMatchObject({ eventType: 'ball_undone', sequenceNumber: 2 });
    expect(mockRedis.del).toHaveBeenCalledTimes(2);
  });

  it('accepts repeated illegal deliveries followed by a legal ball at the same coordinates', async () => {
    await service.recordBall(TENANT, ball({ extras: { type: 'wide', runs: 1 } }));
    await service.recordBall(TENANT, ball({ extras: { type: 'wide', runs: 2 } }));
    await service.recordBall(TENANT, ball({ runs: 1 }));
    expect(mockTx.state.balls.map((row) => row.ballSequence)).toEqual([1, 2, 3]);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: 4, totalBalls: 1, extras: 3, wides: 3 });
    const lock = dialect.sqlToQuery(mockTx.execute.mock.calls[0][0]);
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.params).toContain(TENANT);
  });

  it('replays an accepted operation without new writes or duplicate publication', async () => {
    const input = ball({ runs: 1 });
    const accepted = await service.recordBall(TENANT, input);
    mockTx.state.innings.status = 'completed';
    const replay = await service.recordBall(TENANT, input);
    expect(replay).toMatchObject({ ballId: accepted.ballId, clientOpId: input.clientOpId, replayed: true });
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
    expect(publisher.publishBallEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an operation ID with changed contents', async () => {
    const input = ball({ runs: 1 });
    await service.recordBall(TENANT, input);
    await expect(service.recordBall(TENANT, { ...input, runs: 2 })).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.state.innings.totalRuns).toBe(1);
    expect(mockTx.state.events).toHaveLength(1);
  });

  it('does not resurrect an undone operation, but allows a new command at the same position', async () => {
    const input = ball({ runs: 1 });
    const accepted = await service.recordBall(TENANT, input);
    await service.undoBall(TENANT, MATCH, accepted.ballId);
    await expect(service.recordBall(TENANT, input)).rejects.toBeInstanceOf(ConflictException);
    await service.recordBall(TENANT, ball({ runs: 2 }));
    expect(mockTx.state.innings.totalRuns).toBe(2);
    expect(mockTx.state.events.map((event) => event.sequenceNumber)).toEqual([1, 2, 3]);
  });

  it('rejects stale coordinates, completed innings, and invalid payloads before writes', async () => {
    await expect(service.recordBall(TENANT, ball({ ball: 2 }))).rejects.toBeInstanceOf(ConflictException);
    mockTx.state.innings.status = 'completed';
    await expect(service.recordBall(TENANT, ball())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordBall(TENANT, ball({ runs: NaN }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordBall(TENANT, ball({ clientOpId: '' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.state.events).toHaveLength(0);
    expect(mockTx.state.balls).toHaveLength(0);
  });

  it('fails closed on cross-tenant rows', async () => {
    mockTx.state.match.tenantId = BOWLER;
    await expect(service.recordBall(TENANT, ball())).rejects.toBeInstanceOf(NotFoundException);
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('only undoes the last delivery in sequence order', async () => {
    const first = await service.recordBall(TENANT, ball({ extras: { type: 'wide', runs: 1 } }));
    await service.recordBall(TENANT, ball({ runs: 1 }));
    await expect(service.undoBall(TENANT, MATCH, first.ballId)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.state.balls).toHaveLength(2);
  });

  it('refuses ambiguous legacy extras and corrupted deltas instead of guessing', async () => {
    const accepted = await service.recordBall(TENANT, ball({ extras: { type: 'wide', runs: 5 } }));
    mockTx.state.events[0].payload.delta.totalRuns = 99;
    await expect(service.undoBall(TENANT, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    mockTx.state.events = [];
    await expect(service.undoBall(TENANT, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(mockTx.state.innings.totalRuns).toBe(5);
  });

  it('does not silently clamp inconsistent innings totals on undo', async () => {
    const accepted = await service.recordBall(TENANT, ball({ runs: 4 }));
    mockTx.state.innings.totalRuns = 1;
    await expect(service.undoBall(TENANT, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it('rejects a corrupted legal-ball delta even when its run totals look valid', async () => {
    const accepted = await service.recordBall(TENANT, ball({ runs: 1 }));
    mockTx.state.events[0].payload.delta.legalBalls = 0;
    await expect(service.undoBall(TENANT, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it('preserves wicket totals through record and undo', async () => {
    const accepted = await service.recordBall(TENANT, ball({
      wicket: { type: 'run_out', playerId: BATTER },
    }));
    expect(mockTx.state.innings.totalWickets).toBe(1);
    await service.undoBall(TENANT, MATCH, accepted.ballId);
    expect(mockTx.state.innings.totalWickets).toBe(0);
  });
});
