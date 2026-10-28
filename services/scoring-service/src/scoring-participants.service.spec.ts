import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db, matches, matchBalls, matchInnings, scoringEvents, scorecardProjections, auditLogs, scoringOutbox } from '@mtk/database';
import { ScoringService, BallEvent } from './scoring.service';

/**
 * Batch 100 (ENH-03-02 / ENH-09-02): SCORING_PARTICIPANTS_READY behaviour.
 *
 * With the flag ON: the already-validated wicket attribution (which batter
 * left, plus the dismissing fielder) is persisted on the delivery row, the
 * canonical striker/non-striker/bowler projection is folded inside the
 * recording transaction, and every record AND undo response carries it.
 * The mock env below flips the flag between tests so the same suite also
 * proves the flagged-OFF byte-for-byte legacy shape (no attribution keys
 * inserted, `participants: null`).
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';
const INNINGS = '00000000-0000-4000-8000-000000000003';
const OPENER = '00000000-0000-4000-8000-000000000004';
const PARTNER = '00000000-0000-4000-8000-000000000005';
const INCOMING = '00000000-0000-4000-8000-000000000007';
const BOWLER = '00000000-0000-4000-8000-000000000006';
const ACTOR = '00000000-0000-4000-8000-000000000008';
const TEAM_B = '00000000-0000-4000-8000-000000000009';

// jest requires factory-referenced out-of-scope variables to be mock-prefixed.
const mockParticipantsFlag = { value: 'true' };

jest.mock('./env', () => ({
  ...jest.requireActual('./env'),
  env: new Proxy({ ...jest.requireActual('./env').env }, {
    get: (target, key) => key === 'SCORING_PARTICIPANTS_READY'
      ? mockParticipantsFlag.value
      : target[key as string],
  }),
}));

const mockRedis = { del: jest.fn().mockResolvedValue(1), get: jest.fn(), set: jest.fn() };
let mockTx: ReturnType<typeof createTransaction>;
let sequence = 20;

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));
// Keep real schema/SQL definitions, without initializing any network client.
jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));
jest.mock('@mtk/database', () => ({
  ...jest.requireActual('@mtk/database'),
  db: { transaction: jest.fn(async (fn) => {
    const before = structuredClone(mockTx.state);
    mockTx.inTransaction = true;
    try { return await fn(mockTx); }
    catch (error) { Object.assign(mockTx.state, before); throw error; }
    finally { mockTx.inTransaction = false; }
  }) },
}));

function uuid() {
  sequence++;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

// Same test adapter contract as scoring.service.spec.ts: real Drizzle
// expressions evaluated against an in-memory fixture. The select mock
// additionally supports the fold's `.where(...).orderBy(...)` chain over
// match_balls, because that is the exact read the canonical fold performs
// inside the writing transaction.
function createTransaction() {
  const state = {
    innings: {
      id: INNINGS, tenantId: TENANT, matchId: MATCH, teamId: TENANT,
      inningsNumber: 1, status: 'in_progress', totalRuns: 0, totalWickets: 0,
      totalBalls: 0, extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0,
      updatedAt: new Date('2026-10-22T12:00:00.000Z'),
    },
    match: { id: MATCH, tenantId: TENANT, tournamentId: null as string | null, scorerId: ACTOR as string | null, backupScorerId: null as string | null, teamAId: TENANT, teamBId: TEAM_B,
      winnerId: null as string | null, result: null as string | null, manOfMatchId: null as string | null,
      status: 'live', scoringRevision: 0, scorerHandoverEpoch: 0, startDate: new Date(), updatedAt: new Date('2026-10-22T12:00:00.000Z') },
    actor: { id: ACTOR, isActive: true, role: 'scorer' },
    membership: { userId: ACTOR, tenantId: TENANT, role: 'scorer', status: 'active', expiresAt: null },
    roster: new Map<string, Record<string, any>>([
      [OPENER, { id: OPENER, tenantId: TENANT, teamId: TENANT, isActive: true, status: 'active', name: 'Opener' }],
      [PARTNER, { id: PARTNER, tenantId: TENANT, teamId: TENANT, isActive: true, status: 'active', name: 'Partner' }],
      [INCOMING, { id: INCOMING, tenantId: TENANT, teamId: TENANT, isActive: true, status: 'active', name: 'Incoming' }],
      [BOWLER, { id: BOWLER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active', name: 'Bowler' }],
    ]),
    balls: [] as Array<Record<string, any>>,
    registrations: [] as Array<Record<string, any>>,
    events: [] as Array<Record<string, any>>,
    audits: [] as Array<Record<string, any>>,
    outbox: [] as Array<Record<string, any>>,
    projection: {} as Record<string, any>,
  };
  const selectRows = async (table: unknown): Promise<Array<Record<string, any>>> => {
    if (table === matchBalls) {
      // Canonical fold order: official delivery log by ball sequence.
      return [...state.balls].sort((a, b) => a.ballSequence - b.ballSequence);
    }
    if (table === scoringEvents) {
      return [{ seq: String(Math.max(0, ...state.events.map((event) => event.sequenceNumber))) }];
    }
    return [];
  };
  const thenable = (rows: () => Promise<Array<Record<string, any>>>) => {
    const t: any = {
      orderBy: () => rows(),
      then: (onFulfilled: any, onRejected: any) => rows().then(onFulfilled, onRejected),
      catch: (onRejected: any) => rows().catch(onRejected),
      finally: (onFinally: any) => rows().finally(onFinally),
    };
    // Drizzle builders are self-returning for clustering operators.
    t.limit = () => t;
    t.offset = () => t;
    return t as Record<string, any>;
  };
  const tx = {
    state,
    inTransaction: false,
    execute: jest.fn().mockResolvedValue([]),
    query: {
      matches: { findFirst: jest.fn(async () => ({ ...state.match })) },
      users: { findFirst: jest.fn(async () => ({ ...state.actor })) },
      tenants: { findFirst: jest.fn(async () => ({ id: TENANT, isActive: true })) },
      userTenantRoles: { findFirst: jest.fn(async () => state.membership) },
      matchInnings: { findFirst: jest.fn(async () => ({ ...state.innings })),
        findMany: jest.fn(async () => [{ ...state.innings }]) },
      players: { findFirst: jest.fn(async ({ where }) => state.roster.get(String(dialect.sqlToQuery(where).params[0]))) },
      teams: { findFirst: jest.fn(async ({ where }) => {
        const id = String(dialect.sqlToQuery(where).params[0]);
        return { id, tenantId: TENANT, isActive: true };
      }) },
      leagueRegistrations: { findMany: jest.fn(async () => state.registrations) },
      venues: { findFirst: jest.fn(async () => undefined) },
      tournaments: { findFirst: jest.fn(async () => undefined) },
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
        const eventType = query.params.includes('ball_undone') ? 'ball_undone' : 'ball_recorded';
        return state.events.find((event) => event.eventType === eventType &&
          event.payload[key] != null && query.params.includes(event.payload[key]));
      }) },
    },
    select: jest.fn(() => ({
      from: (table: unknown) => {
        const rows = () => selectRows(table);
        return {
          where: () => thenable(rows),
          ...thenable(rows),
        };
      },
    })),
    insert: jest.fn((table) => ({ values: (values: Record<string, any>) => {
      const row = { ...values, id: uuid(), createdAt: new Date() };
      if (table === matchBalls) state.balls.push(row);
      if (table === scoringEvents) state.events.push(row);
      if (table === auditLogs) state.audits.push(row);
      if (table === scoringOutbox) {
        expect(tx.inTransaction).toBe(true);
        state.outbox.push(row);
      }
      if (table === scorecardProjections) state.projection = row;
      if (table === matchInnings) Object.assign(state.innings, row);
      return { returning: async () => [row] };
    } })),
    update: jest.fn((table) => ({ set: (values: Record<string, any>) => ({ where: () => {
      if (table === matchInnings) {
        for (const [key, value] of Object.entries(values)) {
          if (value instanceof SQL) {
            const amount = Number(dialect.sqlToQuery(value).params[0]);
            state.innings[key] += amount;
          } else state.innings[key] = value;
        }
      } else if (table === scorecardProjections) state.projection = { ...values };
      else if (table === matches) Object.assign(state.match, values);
      return Object.assign(Promise.resolve(undefined), {
        returning: async () => [{ ...(table === matchInnings ? state.innings : state.match) }],
      });
    } }) })),
    delete: jest.fn(() => ({ where: async (where: SQL) => {
      const query = dialect.sqlToQuery(where);
      state.balls = state.balls.filter((ball) => !query.params.includes(ball.id));
    } })),
  };
  return tx;
}

const dialect = new PgDialect();

function ball(input: Partial<BallEvent> = {}): BallEvent {
  return {
    matchId: MATCH, inningsId: INNINGS, over: 0, ball: 1, runs: 0,
    batsmanId: OPENER, bowlerId: BOWLER, timestamp: new Date(),
    clientOpId: uuid(), expectedRevision: mockTx.state.match.scoringRevision, ...input,
  };
}

describe('Batch 100: canonical participants with SCORING_PARTICIPANTS_READY on', () => {
  let service: ScoringService;
  beforeEach(() => {
    mockParticipantsFlag.value = 'true';
    jest.clearAllMocks();
    mockRedis.get.mockReset().mockResolvedValue(null);
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.del.mockImplementation(async () => {
      expect(mockTx.inTransaction).toBe(false);
      return 1;
    });
    mockTx = createTransaction();
    service = new ScoringService();
  });

  it('persists scorer-named attribution and folds confirmed crease state on the record response', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ ball: 1 }));
    await service.recordBall(TENANT, ACTOR, ball({ ball: 2, batsmanId: PARTNER }));
    // Off-strike run-out: the non-striker (PARTNER) is the one who left.
    const out = await service.recordBall(TENANT, ACTOR, ball({
      ball: 3, wicket: { type: 'run_out', playerId: PARTNER } as BallEvent['wicket'],
    }));
    expect(mockTx.state.balls[0]).toEqual(expect.objectContaining({
      wicketPlayerOutId: null, wicketFielderId: null,
    }));
    expect(mockTx.state.balls[2]).toEqual(expect.objectContaining({
      wicketType: 'run_out', wicketPlayerOutId: PARTNER,
    }));
    expect(out.participants).toEqual(expect.objectContaining({
      confirmed: true, strikerId: OPENER, creaseBatterIds: [OPENER], lastBallSequence: 3,
    }));
    expect(out.participants?.incomingBatterId).toBeNull();
  });

  it('marks the replacement batter incoming on their first recorded delivery', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ ball: 1 }));
    await service.recordBall(TENANT, ACTOR, ball({ ball: 2, batsmanId: PARTNER }));
    await service.recordBall(TENANT, ACTOR, ball({ ball: 3, batsmanId: PARTNER, wicket: { type: 'bowled', playerId: PARTNER } as BallEvent['wicket'] }));
    expect(mockTx.state.balls[2]).toEqual(expect.objectContaining({
      wicketType: 'bowled', wicketPlayerOutId: PARTNER,
    }));
    const replacement = await service.recordBall(TENANT, ACTOR, ball({ ball: 4, batsmanId: INCOMING }));
    expect(replacement.participants).toEqual(expect.objectContaining({
      confirmed: true, strikerId: INCOMING, nonStrikerId: OPENER,
      incomingBatterId: INCOMING, creaseBatterIds: [OPENER, INCOMING],
    }));
  });

  it('refolds onto the undo response so retracted strikes disappear with the ball', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ ball: 1 }));
    const second = await service.recordBall(TENANT, ACTOR, ball({ ball: 2, batsmanId: PARTNER }));
    expect(second.participants).toEqual(expect.objectContaining({
      confirmed: true, strikerId: PARTNER, nonStrikerId: OPENER,
    }));
    const undone = await service.undoBall(TENANT, ACTOR, MATCH, second.ballId, 0, mockTx.state.match.scoringRevision);
    // Post-delete fold: only the opener's delivery remains, so the fold must
    // NOT keep claiming the undone striker.
    expect(undone.participants).toEqual(expect.objectContaining({
      confirmed: true, strikerId: OPENER, creaseBatterIds: [OPENER], lastBallSequence: 1,
    }));
  });

  it('keeps the record winning over prediction: an off-crease attribution degrades, not invents', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ ball: 1 }));
    const out = await service.recordBall(TENANT, ACTOR, ball({
      ball: 2, wicket: { type: 'run_out', playerId: INCOMING } as BallEvent['wicket'],
    }));
    expect(out.participants?.confirmed).toBe(false);
  });
});

describe('Batch 100: SCORING_PARTICIPANTS_READY off restores the legacy shape', () => {
  let service: ScoringService;
  beforeEach(() => {
    mockParticipantsFlag.value = 'false';
    jest.clearAllMocks();
    mockRedis.get.mockReset().mockResolvedValue(null);
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.del.mockImplementation(async () => 1);
    mockTx = createTransaction();
    service = new ScoringService();
  });

  it('never writes attribution keys and returns participants: null on record and undo', async () => {
    const first = await service.recordBall(TENANT, ACTOR, ball({ ball: 1 }));
    expect(first.participants).toBeNull();
    expect(mockTx.state.balls[0]).not.toHaveProperty('wicketPlayerOutId');
    expect(mockTx.state.balls[0]).not.toHaveProperty('wicketFielderId');

    const second = await service.recordBall(TENANT, ACTOR, ball({
      ball: 2, batsmanId: PARTNER,
      wicket: { type: 'run_out', playerId: PARTNER } as BallEvent['wicket'],
    }));
    expect(second.participants).toBeNull();
    expect(mockTx.state.balls[1]).toEqual(expect.objectContaining({
      wicketType: 'run_out',
      // The command still carries attribution for validation; only the
      // persistence and the fold are gated. The legacy row never gains the
      // new keys, so it is byte-for-byte the pre-Batch-100 shape.
    }));
    expect(mockTx.state.balls[1]).not.toHaveProperty('wicketPlayerOutId');

    const undone = await service.undoBall(TENANT, ACTOR, MATCH, second.ballId, 0, mockTx.state.match.scoringRevision);
    expect(undone.participants).toBeNull();
  });
});
