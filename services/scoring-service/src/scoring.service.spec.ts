import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db, matches, matchBalls, matchInnings, scoringEvents, scorecardProjections, auditLogs, scoringOutbox } from '@mtk/database';
import { ScoringService, BallEvent } from './scoring.service';
import type { SquadRegistration } from '@mtk/database/lib/registered-squad-eligibility';

const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';
const INNINGS = '00000000-0000-4000-8000-000000000003';
const BATTER = '00000000-0000-4000-8000-000000000004';
const BOWLER = '00000000-0000-4000-8000-000000000005';
const ACTOR = '00000000-0000-4000-8000-000000000006';
const TEAM_B = '00000000-0000-4000-8000-000000000007';
const TOURNAMENT = '00000000-0000-4000-8000-000000000008';
const dialect = new PgDialect();
const mockRedis = { del: jest.fn().mockResolvedValue(1), get: jest.fn(), set: jest.fn() };
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

// Test adapter evaluates real Drizzle expressions against an in-memory fixture.
// It proves service accounting/transaction boundaries, not PostgreSQL lock behavior.
function createTransaction() {
  const state = {
    innings: {
      id: INNINGS, tenantId: TENANT, matchId: MATCH, teamId: TENANT,
      inningsNumber: 1, status: 'in_progress', totalRuns: 0, totalWickets: 0,
      totalBalls: 0, extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0,
      updatedAt: new Date('2026-10-12T12:00:00.000Z'),
    },
    match: { id: MATCH, tenantId: TENANT, tournamentId: null as string | null, scorerId: ACTOR as string | null, backupScorerId: null as string | null, teamAId: TENANT, teamBId: TEAM_B,
      winnerId: null as string | null, result: null as string | null, manOfMatchId: null as string | null,
      status: 'live', startDate: new Date(), updatedAt: new Date('2026-10-12T12:00:00.000Z') },
    actor: { id: ACTOR, isActive: true, role: 'scorer', tenantIds: [TENANT] },
    membership: { userId: ACTOR, tenantId: TENANT, role: 'scorer', status: 'active' } as { userId: string; tenantId: string; role: string; status: string } | null,
    roster: new Map<string, Record<string, any>>([
      [BATTER, { id: BATTER, tenantId: TENANT, teamId: TENANT, isActive: true, status: 'active', name: 'Batter' }],
      [BOWLER, { id: BOWLER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active', name: 'Bowler' }],
    ]),
    balls: [] as Array<Record<string, any>>,
    registrations: [] as SquadRegistration[],
    events: [] as Array<Record<string, any>>,
    audits: [] as Array<Record<string, any>>,
    outbox: [] as Array<Record<string, any>>,
    projection: {} as Record<string, any>,
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
        findMany: jest.fn(async (_options: { where: SQL; orderBy: unknown[] }) => [{ ...state.innings }]) },
      players: { findFirst: jest.fn(async ({ where }) => state.roster.get(String(dialect.sqlToQuery(where).params[0]))) },
      teams: { findFirst: jest.fn(async ({ where }) => {
        const id = String(dialect.sqlToQuery(where).params[0]);
        return { id, tenantId: TENANT, isActive: true };
      }) },
      leagueRegistrations: { findMany: jest.fn(async (_options: unknown) => state.registrations) },
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

function ball(input: Partial<BallEvent> = {}): BallEvent {
  return {
    matchId: MATCH, inningsId: INNINGS, over: 0, ball: 1, runs: 0,
    batsmanId: BATTER, bowlerId: BOWLER, timestamp: new Date(),
    clientOpId: uuid(), ...input,
  };
}

describe('Canonical delivery record, replay and undo', () => {
  let service: ScoringService;
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockReset().mockResolvedValue(null);
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockTx = createTransaction();
    mockRedis.del.mockImplementation(async () => {
      expect(mockTx.inTransaction).toBe(false);
      return 1;
    });
    service = new ScoringService();
  });

  it('returns complete live metadata from a tenant-scoped consistent read transaction', async () => {
    mockTx.state.innings.extras = 2;
    mockTx.state.innings.totalRuns = 5;
    const state = await service.getMatchState(MATCH, true);
    expect(state).toMatchObject({ version: 2, matchId: MATCH, innings1: {
      inningsId: INNINGS, teamId: TENANT, extras: 2, totalRuns: 5, status: 'in_progress',
    } });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const query = dialect.sqlToQuery(mockTx.query.matchInnings.findMany.mock.calls[0][0].where);
    expect(query.params).toEqual([MATCH, TENANT]);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('rejects an old cached contract and bounds polling cache freshness', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ matchId: MATCH, status: 'live', currentInnings: 1 }));
    expect((await service.getMatchState(MATCH))?.version).toBe(2);
    expect(mockRedis.del).toHaveBeenCalledWith(`match:state:${MATCH}`);
    expect(mockRedis.set).toHaveBeenCalledWith(`match:state:${MATCH}`, expect.any(String), 'EX', 5);
  });

  it('does not return a valid cache snapshot belonging to another match', async () => {
    const foreign = await service.getMatchState(MATCH, true);
    mockRedis.get.mockResolvedValue(JSON.stringify({ ...foreign, matchId: BATTER, innings1: { ...foreign.innings1, matchId: BATTER } }));
    expect((await service.getMatchState(MATCH))?.matchId).toBe(MATCH);
    expect(mockRedis.del).toHaveBeenCalledWith(`match:state:${MATCH}`);
  });

  it.each([
    { extras: undefined, runs: 4, total: 4, extraRuns: 0, legalBalls: 1 },
    { extras: { type: 'wide' as const, runs: 5 }, runs: 0, total: 5, extraRuns: 5, legalBalls: 0 },
    { extras: { type: 'noball' as const, runs: 1 }, runs: 4, total: 5, extraRuns: 1, legalBalls: 0 },
    { extras: { type: 'bye' as const, runs: 4 }, runs: 0, total: 4, extraRuns: 4, legalBalls: 1 },
    { extras: { type: 'legbye' as const, runs: 2 }, runs: 0, total: 2, extraRuns: 2, legalBalls: 1 },
  ])('records and exactly reverses $extras', async ({ extras, runs, total, extraRuns, legalBalls }) => {
    const accepted = await service.recordBall(TENANT, ACTOR, ball({ runs, extras }));
    expect(accepted.scorecard.totalRuns).toBe(total);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: total, totalBalls: legalBalls, extras: extraRuns });
    expect(mockTx.state.balls[0].runs).toBe(total);
    expect(mockTx.state.events[0]).toMatchObject({ eventVersion: 2, sequenceNumber: 1 });

    await service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: 0, totalBalls: 0, totalWickets: 0,
      extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0 });
    expect(mockTx.state.projection).toMatchObject({ totalRuns: 0, totalExtras: 0, byes: 0, legByes: 0 });
    expect(mockTx.state.events[1]).toMatchObject({ eventType: 'ball_undone', sequenceNumber: 2 });
    for (const event of mockTx.state.events) expect(event.metadata).toEqual({ actor_user_id: ACTOR, actor_tenant_id: TENANT });
    expect(mockRedis.del).toHaveBeenCalledTimes(2);
  });

  it('accepts repeated illegal deliveries followed by a legal ball at the same coordinates', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ extras: { type: 'wide', runs: 1 } }));
    await service.recordBall(TENANT, ACTOR, ball({ extras: { type: 'wide', runs: 2 } }));
    await service.recordBall(TENANT, ACTOR, ball({ runs: 1 }));
    expect(mockTx.state.balls.map((row) => row.ballSequence)).toEqual([1, 2, 3]);
    expect(mockTx.state.innings).toMatchObject({ totalRuns: 4, totalBalls: 1, extras: 3, wides: 3 });
    const lock = dialect.sqlToQuery(mockTx.execute.mock.calls[0][0]);
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.params).toContain(TENANT);
  });

  it('replays an accepted operation without new writes or duplicate publication', async () => {
    const input = ball({ runs: 1 });
    const accepted = await service.recordBall(TENANT, ACTOR, input);
    mockTx.state.innings.status = 'completed';
    const replay = await service.recordBall(TENANT, ACTOR, input);
    expect(replay).toMatchObject({ ballId: accepted.ballId, clientOpId: input.clientOpId, replayed: true });
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
    expect(mockTx.state.outbox).toHaveLength(1);
  });

  function registeredMatch() {
    mockTx.state.match.tournamentId = TOURNAMENT;
    mockTx.state.registrations = [
      { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TENANT, status: 'approved', squadPlayerIds: [BATTER] },
      { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_B, status: 'approved', squadPlayerIds: [BOWLER] },
    ];
  }

  it('records a delivery using the approved declared tournament squads', async () => {
    registeredMatch();
    await service.recordBall(TENANT, ACTOR, ball({ runs: 4 }));
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
    expect(mockTx.state.innings.totalRuns).toBe(4);
  });

  it.each([0, 1])('rejects an undeclared participant on side %s before ball/event/projection writes', async side => {
    registeredMatch();
    mockTx.state.registrations[side].squadPlayerIds = [ACTOR];
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toThrow('approved tournament squad');
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.state.outbox).toHaveLength(0);
  });

  it('rejects a withdrawn registration before any new delivery effect', async () => {
    registeredMatch();
    mockTx.state.registrations[0].status = 'withdrawn';
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toThrow('approved tournament squad');
    expect(mockTx.state.balls).toHaveLength(0);
    expect(mockTx.state.events).toHaveLength(0);
    expect(mockTx.state.innings.totalBalls).toBe(0);
  });

  it('acknowledges an accepted operation after withdrawal but blocks a new operation', async () => {
    registeredMatch();
    const input = ball({ runs: 1 });
    const accepted = await service.recordBall(TENANT, ACTOR, input);
    mockTx.state.registrations[0].status = 'withdrawn';
    expect(await service.recordBall(TENANT, ACTOR, input)).toMatchObject({ ballId: accepted.ballId, replayed: true });
    await expect(service.recordBall(TENANT, ACTOR, ball({ ball: 2 }))).rejects.toThrow('approved tournament squad');
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
    expect(mockTx.state.innings.totalRuns).toBe(1);
    expect(mockTx.state.outbox).toHaveLength(1);
  });

  it('propagates a squad lookup failure before any delivery write', async () => {
    registeredMatch();
    mockTx.query.leagueRegistrations.findMany.mockRejectedValue(new Error('Squad lookup unavailable'));
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toThrow('Squad lookup unavailable');
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it('rejects reuse of an operation ID with changed contents', async () => {
    const input = ball({ runs: 1 });
    await service.recordBall(TENANT, ACTOR, input);
    await expect(service.recordBall(TENANT, ACTOR, { ...input, runs: 2 })).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.state.innings.totalRuns).toBe(1);
    expect(mockTx.state.events).toHaveLength(1);
  });

  it('does not resurrect an undone operation, but allows a new command at the same position', async () => {
    const input = ball({ runs: 1 });
    const accepted = await service.recordBall(TENANT, ACTOR, input);
    await service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId);
    await expect(service.recordBall(TENANT, ACTOR, input)).rejects.toBeInstanceOf(ConflictException);
    await service.recordBall(TENANT, ACTOR, ball({ runs: 2 }));
    expect(mockTx.state.innings.totalRuns).toBe(2);
    expect(mockTx.state.events.map((event) => event.sequenceNumber)).toEqual([1, 2, 3]);
  });

  it('rejects stale coordinates, completed innings, and invalid payloads before writes', async () => {
    await expect(service.recordBall(TENANT, ACTOR, ball({ ball: 2 }))).rejects.toBeInstanceOf(ConflictException);
    mockTx.state.innings.status = 'completed';
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordBall(TENANT, ACTOR, ball({ runs: NaN }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordBall(TENANT, ACTOR, ball({ clientOpId: '' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.state.events).toHaveLength(0);
    expect(mockTx.state.balls).toHaveLength(0);
  });

  it('fails closed on cross-tenant rows', async () => {
    mockTx.state.match.tenantId = BOWLER;
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toBeInstanceOf(NotFoundException);
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('only undoes the last delivery in sequence order', async () => {
    const first = await service.recordBall(TENANT, ACTOR, ball({ extras: { type: 'wide', runs: 1 } }));
    await service.recordBall(TENANT, ACTOR, ball({ runs: 1 }));
    await expect(service.undoBall(TENANT, ACTOR, MATCH, first.ballId)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.state.balls).toHaveLength(2);
  });

  it('refuses ambiguous legacy extras and corrupted deltas instead of guessing', async () => {
    const accepted = await service.recordBall(TENANT, ACTOR, ball({ extras: { type: 'wide', runs: 5 } }));
    mockTx.state.events[0].payload.delta.totalRuns = 99;
    await expect(service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    mockTx.state.events = [];
    await expect(service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(mockTx.state.innings.totalRuns).toBe(5);
  });

  it('does not silently clamp inconsistent innings totals on undo', async () => {
    const accepted = await service.recordBall(TENANT, ACTOR, ball({ runs: 4 }));
    mockTx.state.innings.totalRuns = 1;
    await expect(service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it('rejects a corrupted legal-ball delta even when its run totals look valid', async () => {
    const accepted = await service.recordBall(TENANT, ACTOR, ball({ runs: 1 }));
    mockTx.state.events[0].payload.delta.legalBalls = 0;
    await expect(service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it('preserves wicket totals through record and undo', async () => {
    const accepted = await service.recordBall(TENANT, ACTOR, ball({
      wicket: { type: 'run_out', playerId: BATTER },
    }));
    expect(mockTx.state.innings.totalWickets).toBe(1);
    await service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId);
    expect(mockTx.state.innings.totalWickets).toBe(0);
  });

  function mutation(operation: string) {
    if (operation === 'record') return service.recordBall(TENANT, ACTOR, ball());
    if (operation === 'undo') return service.undoBall(TENANT, ACTOR, MATCH, BATTER);
    if (operation === 'create') return service.createInnings(TENANT, ACTOR, { matchId: MATCH, teamId: TENANT, inningsNumber: 2 });
    if (operation === 'complete innings') return service.completeInnings(TENANT, ACTOR, MATCH, INNINGS);
    return service.completeMatch(TENANT, ACTOR, MATCH);
  }

  it.each(['record', 'undo', 'create', 'complete innings', 'complete match'])('rechecks revoked assignment inside the %s transaction before any writes', async (operation) => {
    mockTx.state.match.scorerId = null;
    await expect(mutation(operation)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(mockTx.state.outbox).toHaveLength(0);
    expect(dialect.sqlToQuery(mockTx.execute.mock.calls[0][0]).params).toEqual([MATCH, TENANT]);
  });
  it.each(['record', 'undo', 'create', 'complete innings', 'complete match'])('blocks suspended membership inside the %s transaction before any writes', async (operation) => {
    mockTx.state.membership!.status = 'suspended';
    await expect(mutation(operation)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(mockTx.state.outbox).toHaveLength(0);
  });
  it.each(['record', 'undo', 'create', 'complete innings', 'complete match'])('rejects revoked backup inside the %s transaction', async (operation) => {
    mockTx.state.match.scorerId = TEAM_B;
    mockTx.state.match.backupScorerId = null;
    await expect(mutation(operation)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(mockTx.state.outbox).toHaveLength(0);
  });
  it('records, replays and undoes as active backup without changing either assignment', async () => {
    mockTx.state.match.scorerId = TEAM_B;
    mockTx.state.match.backupScorerId = ACTOR;
    const input = ball({ runs: 4 });
    const accepted = await service.recordBall(TENANT, ACTOR, input);
    expect(mockTx.state.innings.totalRuns).toBe(4);
    expect((await service.recordBall(TENANT, ACTOR, input)).replayed).toBe(true);
    await service.undoBall(TENANT, ACTOR, MATCH, accepted.ballId);
    expect(mockTx.state.innings.totalRuns).toBe(0);
    expect(mockTx.state.match.scorerId).toBe(TEAM_B);
    expect(mockTx.state.match.backupScorerId).toBe(ACTOR);
  });
  it('does not acknowledge an accepted backup delivery after backup revocation', async () => {
    mockTx.state.match.scorerId = TEAM_B;
    mockTx.state.match.backupScorerId = ACTOR;
    const input = ball({ runs: 1 });
    await service.recordBall(TENANT, ACTOR, input);
    mockTx.state.match.backupScorerId = null;
    await expect(service.recordBall(TENANT, ACTOR, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
  });

  it.each(['record', 'undo', 'create', 'complete innings', 'complete match'])('rejects deactivated accounts on %s', async (operation) => {
    mockTx.state.actor.isActive = false;
    await expect(mutation(operation)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('does not acknowledge a previously accepted delivery after assignment revocation', async () => {
    const input = ball({ runs: 1 });
    await service.recordBall(TENANT, ACTOR, input);
    mockTx.state.match.scorerId = null;
    await expect(service.recordBall(TENANT, ACTOR, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockTx.state.balls).toHaveLength(1);
    expect(mockTx.state.events).toHaveLength(1);
  });

  it('acknowledges accepted deliveries after roster changes, but blocks new ineligible writes', async () => {
    const input = ball({ runs: 1 });
    await service.recordBall(TENANT, ACTOR, input);
    mockTx.state.roster.get(BATTER)!.status = 'suspended';
    expect((await service.recordBall(TENANT, ACTOR, input)).replayed).toBe(true);
    await expect(service.recordBall(TENANT, ACTOR, ball({ ball: 2 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.state.events).toHaveLength(1);
  });

  it('rejects a foreign-tenant participant before projection, ball, or event writes', async () => {
    mockTx.state.roster.get(BOWLER)!.tenantId = TEAM_B;
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toBeInstanceOf(NotFoundException);
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it('serializes innings creation and invalidates state only after its committed insert', async () => {
    mockTx.query.matchInnings.findFirst.mockResolvedValueOnce(undefined);
    const result = await service.createInnings(TENANT, ACTOR, { matchId: MATCH, teamId: TENANT, inningsNumber: 2 });
    expect(result).toMatchObject({ matchId: MATCH, teamId: TENANT, inningsNumber: 2, status: 'not_started' });
    expect(dialect.sqlToQuery(mockTx.execute.mock.calls[0][0]).sql).toContain('FOR UPDATE');
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
  });

  it('completes innings using the same lock and applies the break inside the transaction', async () => {
    const result = await service.completeInnings(TENANT, ACTOR, MATCH, INNINGS);
    expect(result).toMatchObject({ matchStatus: 'innings_break', inningsBreakApplied: true, innings: { status: 'completed' } });
    expect(mockTx.state.match.status).toBe('innings_break');
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite a completed innings timestamp on a repeated completion', async () => {
    mockTx.state.innings.status = 'completed';
    mockTx.state.match.status = 'innings_break';
    const timestamp = mockTx.state.innings.updatedAt;
    const result = await service.completeInnings(TENANT, ACTOR, MATCH, INNINGS);
    expect(result.inningsBreakApplied).toBe(false);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.state.innings.updatedAt).toBe(timestamp);
  });

  it.each(['abandoned', 'cancelled', 'no_result'])('cannot newly complete an innings of a %s match', async (status) => {
    mockTx.state.match.status = status;
    await expect(service.completeInnings(TENANT, ACTOR, MATCH, INNINGS)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it.each(['abandoned', 'cancelled', 'no_result'])('cannot replace a %s match with a completed result', async (status) => {
    mockTx.state.match.status = status;
    await expect(service.completeMatch(TENANT, ACTOR, MATCH)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('validates malformed resource IDs and completion details before SQL', async () => {
    await expect(service.undoBall(TENANT, ACTOR, 'invalid', BATTER)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.completeInnings(TENANT, ACTOR, MATCH, 'invalid')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, undefined, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.execute).not.toHaveBeenCalled();
  });

  it('serializes match completion and does not overwrite a completed result on retry', async () => {
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won by 3 runs');
    const timestamp = mockTx.state.match.updatedAt;
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won by 3 runs');
    expect(mockTx.state.outbox).toHaveLength(1);
    expect(mockTx.state.outbox[0]).toMatchObject({ eventId: `${MATCH}:MatchEnded`, tenantId: TENANT, matchId: MATCH });
    expect(mockTx.state.match.updatedAt).toBe(timestamp);
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, TEAM_B, 'Changed winner')).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.state.match.winnerId).toBe(TENANT);
  });

  it('rejects third-team winners without completing the match', async () => {
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, BATTER)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.state.match.status).toBe('live');
  });
  it('completes and audits the optional match-team award under the canonical transaction', async () => {
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won', BATTER);
    expect(mockTx.state.match.manOfMatchId).toBe(BATTER);
    const lock = dialect.sqlToQuery(mockTx.execute.mock.calls.at(-1)[0]);
    expect(lock.params).toEqual([BATTER, TENANT]);
    expect(lock.sql).toContain('FOR SHARE');
    expect(dialect.sqlToQuery(mockTx.query.players.findFirst.mock.calls[0][0].where).params).toEqual([BATTER, TENANT]);
    expect(mockTx.state.audits).toEqual([expect.objectContaining({ method: 'MATCH_COMPLETE', tenantId: TENANT, actorId: ACTOR,
      payload: expect.objectContaining({ before: expect.objectContaining({ status: 'live', manOfMatchId: null }),
        after: expect.objectContaining({ status: 'completed', manOfMatchId: BATTER }) }) })]);
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won', BATTER);
    // Legacy clients omit the award; a retry must not clear the committed one.
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won');
    expect(mockTx.state.audits).toHaveLength(1);
    expect(mockTx.state.outbox).toHaveLength(1);
    expect(mockTx.state.outbox[0].payload.data.motmName).toBe('Batter');
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won', BOWLER)).rejects.toBeInstanceOf(ConflictException);
    expect(mockTx.state.match.manOfMatchId).toBe(BATTER);
  });
  it.each([undefined, { id: BATTER, tenantId: TEAM_B, teamId: TENANT },
    { id: BOWLER, tenantId: TENANT, teamId: TENANT }, { id: BATTER, tenantId: TENANT, teamId: ACTOR }])(
    'rejects missing, foreign or third-team award recipient %s before writes', async player => {
      mockTx.query.players.findFirst.mockResolvedValueOnce(player);
      await expect(service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won', BATTER)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    },
  );
  it('rejects a malformed award UUID before SQL', async () => {
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won', 'bad')).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTx.execute).not.toHaveBeenCalled();
  });
  it('preserves and validates a pre-existing award when a legacy first completion omits it', async () => {
    mockTx.state.match.manOfMatchId = BATTER;
    await service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won');
    expect(mockTx.state.match.manOfMatchId).toBe(BATTER);
    expect(mockTx.state.audits[0].payload.after.manOfMatchId).toBe(BATTER);
    expect(mockTx.query.players.findFirst).toHaveBeenCalledTimes(2);
  });
  it('propagates completion audit failure before cache invalidation or match-ended publication', async () => {
    mockTx.insert.mockImplementationOnce(() => { throw new Error('Audit unavailable'); });
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won')).rejects.toThrow('Audit unavailable');
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(mockTx.state.outbox).toHaveLength(0);
    // This in-memory adapter does not prove PostgreSQL rollback.
  });
  it('journals the canonical delivery payload and stable scoring-event identity inside the transaction', async () => {
    await service.recordBall(TENANT, ACTOR, ball({ runs: 4 }));
    expect(mockTx.state.outbox).toHaveLength(1);
    expect(mockTx.state.outbox[0]).toMatchObject({ topic: 'ssl.scoring.ball-events', tenantId: TENANT, matchId: MATCH,
      eventId: mockTx.state.events[0].id, payload: { type: 'FOUR_HIT', eventId: mockTx.state.events[0].id,
        data: { tenantId: TENANT, matchId: MATCH, inningsId: INNINGS }, runs: 4, sequenceNumber: 1 } });
  });
  it.each(['scheduled', 'toss'])('journals the %s-to-live intro before the first delivery, once only', async status => {
    mockTx.state.match.status = status;
    const input = ball();
    await service.recordBall(TENANT, ACTOR, input);
    expect(mockTx.state.outbox.map(row => row.payload.type)).toEqual(['MatchStarted', 'BALL_RECORDED']);
    expect(mockTx.state.outbox[0].eventId).toBe(`${MATCH}:MatchStarted`);
    await service.recordBall(TENANT, ACTOR, input);
    expect(mockTx.state.outbox).toHaveLength(2);
  });
  it('does not enqueue a second intro when resuming after the innings break', async () => {
    mockTx.state.match.status = 'innings_break';
    await service.recordBall(TENANT, ACTOR, ball());
    expect(mockTx.state.outbox.map(row => row.payload.type)).toEqual(['BALL_RECORDED']);
  });
  it('rejects the scoring transaction if durable delivery journaling fails (emulated rollback)', async () => {
    const original = mockTx.insert.getMockImplementation()!;
    mockTx.insert.mockImplementation(table => {
      if (table === scoringOutbox) throw new Error('Outbox storage unavailable');
      return original(table);
    });
    await expect(service.recordBall(TENANT, ACTOR, ball({ runs: 6 }))).rejects.toThrow('Outbox storage unavailable');
    expect(mockTx.state.balls).toHaveLength(0);
    expect(mockTx.state.events).toHaveLength(0);
    expect(mockTx.state.innings.totalRuns).toBe(0);
    expect(mockRedis.del).not.toHaveBeenCalled();
  });
  it('does not complete/audit a result without its durable end event (emulated rollback)', async () => {
    const original = mockTx.insert.getMockImplementation()!;
    mockTx.insert.mockImplementation(table => {
      if (table === scoringOutbox) throw new Error('Outbox storage unavailable');
      return original(table);
    });
    await expect(service.completeMatch(TENANT, ACTOR, MATCH, TENANT, 'Won')).rejects.toThrow('Outbox storage unavailable');
    expect(mockTx.state.match.status).toBe('live');
    expect(mockTx.state.audits).toHaveLength(0);
    expect(mockRedis.del).not.toHaveBeenCalled();
  });
  it('scopes lifecycle name lookups to the league and never includes foreign display metadata', async () => {
    mockTx.state.match.status = 'scheduled';
    mockTx.query.teams.findFirst.mockImplementation(async ({ where }) => {
      const id = String(dialect.sqlToQuery(where).params[0]);
      return { id, tenantId: TEAM_B, isActive: true, name: 'Foreign private name' } as never;
    });
    // The canonical team ownership check blocks before intro/outbox creation.
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toBeInstanceOf(NotFoundException);
    expect(mockTx.state.outbox).toHaveLength(0);
  });
  it('refuses foreign metadata from a faulty intro reader after valid team/participant checks', async () => {
    mockTx.state.match.status = 'scheduled';
    let calls = 0;
    mockTx.query.teams.findFirst.mockImplementation(async ({ where }) => {
      const id = String(dialect.sqlToQuery(where).params[0]);
      calls++;
      return { id, tenantId: calls <= 2 ? TENANT : TEAM_B, isActive: true, name: 'Foreign name' } as never;
    });
    await service.recordBall(TENANT, ACTOR, ball());
    expect(mockTx.state.outbox[0].payload.data).toMatchObject({ teamAName: 'Team A', teamBName: 'Team B' });
    for (const [options] of mockTx.query.teams.findFirst.mock.calls) expect(dialect.sqlToQuery(options.where).params[1]).toBe(TENANT);
  });
  it('rolls back the first delivery and intro together if its journal metadata lookup fails', async () => {
    mockTx.state.match.status = 'scheduled';
    mockTx.state.match.tournamentId = TOURNAMENT;
    mockTx.query.tournaments.findFirst.mockRejectedValue(new Error('Tournament metadata unavailable'));
    await expect(service.recordBall(TENANT, ACTOR, ball())).rejects.toThrow('Tournament metadata unavailable');
    expect(mockTx.state.match.status).toBe('scheduled');
    expect(mockTx.state.balls).toHaveLength(0);
    expect(mockTx.state.events).toHaveLength(0);
    expect(mockTx.state.outbox).toHaveLength(0);
  });
});
