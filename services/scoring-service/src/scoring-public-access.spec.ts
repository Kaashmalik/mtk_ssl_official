import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@mtk/database';
import { ScoringService } from './scoring.service';
import { KafkaScoringPublisher } from './kafka-scoring-publisher.service';
import { publicMatchRoom } from './scoring-public-access';
import type { ScoringTransaction } from './scoring-write-access';

const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => mockRedis) }));
jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));
jest.mock('@mtk/database', () => ({ ...jest.requireActual('@mtk/database'), db: { transaction: jest.fn() } }));

const TENANT = '00000000-0000-4000-8000-000000000001';
const MATCH = '00000000-0000-4000-8000-000000000002';
const INNINGS = '00000000-0000-4000-8000-000000000003';
const TOURNAMENT = '00000000-0000-4000-8000-000000000004';
const OTHER = '00000000-0000-4000-8000-000000000005';
const dialect = new PgDialect();

function adapter() {
  const match = { id: MATCH, tenantId: TENANT, tournamentId: TOURNAMENT as string | null, status: 'live', updatedAt: new Date('2026-10-16T10:00:00Z') };
  const innings = { id: INNINGS, matchId: MATCH, tenantId: TENANT, teamId: OTHER, inningsNumber: 1, status: 'in_progress',
    totalRuns: 12, totalWickets: 0, totalBalls: 6, extras: 2, wides: 1, noBalls: 1, byes: 0, legByes: 0, updatedAt: new Date('2026-10-16T10:00:00Z') };
  const mock = { query: {
    matches: { findFirst: jest.fn().mockResolvedValue(match) },
    tenants: { findFirst: jest.fn().mockResolvedValue({ id: TENANT, isActive: true }) },
    tournaments: { findFirst: jest.fn().mockResolvedValue({ id: TOURNAMENT, tenantId: TENANT, status: 'live' }) },
    matchInnings: { findFirst: jest.fn().mockResolvedValue(innings), findMany: jest.fn().mockResolvedValue([innings]) },
    matchBalls: { findMany: jest.fn().mockResolvedValue([{ id: OTHER, matchId: MATCH, inningsId: INNINGS, runs: 4 }]) },
  } };
  return { mock, match, innings, tx: mock as unknown as ScoringTransaction };
}

describe('Public live scoring reads are exact-league and publication-gated', () => {
  let fixture: ReturnType<typeof adapter>;
  let service: ScoringService;
  beforeEach(() => {
    jest.clearAllMocks();
    fixture = adapter();
    (db.transaction as jest.Mock).mockImplementation(async callback => callback(fixture.tx));
    service = new ScoringService({} as KafkaScoringPublisher);
  });
  it('reads the match, active league and same-league parent in a single read-only snapshot', async () => {
    const snapshot = await service.getPublicMatchState(TENANT, MATCH);
    expect(snapshot).toMatchObject({ version: 2, matchId: MATCH, innings1: { totalRuns: 12, extras: 2, totalBalls: 6 } });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    expect(dialect.sqlToQuery(fixture.mock.query.matches.findFirst.mock.calls[0][0].where).params).toEqual([MATCH, TENANT]);
    expect(dialect.sqlToQuery(fixture.mock.query.tenants.findFirst.mock.calls[0][0].where).params).toEqual([TENANT, true]);
    expect(dialect.sqlToQuery(fixture.mock.query.tournaments.findFirst.mock.calls[0][0].where).params).toEqual([TOURNAMENT, TENANT]);
    expect(dialect.sqlToQuery(fixture.mock.query.matchInnings.findMany.mock.calls[0][0].where).params).toEqual([MATCH, TENANT]);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
  it.each(['draft', 'cancelled', 'unknown'])('never returns a cached snapshot for parent status %s', async status => {
    fixture.mock.query.tournaments.findFirst.mockResolvedValue({ id: TOURNAMENT, tenantId: TENANT, status });
    mockRedis.get.mockResolvedValue('a previously valid snapshot');
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(fixture.mock.query.matchInnings.findMany).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'unknown'])('hides match status %s without reading children', async status => {
    fixture.match.status = status;
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.mock.query.matchInnings.findMany).not.toHaveBeenCalled();
  });
  it.each([null, { id: TENANT, isActive: false }, { id: OTHER, isActive: true }])('hides inactive/missing/mismatched league %s', async tenant => {
    fixture.mock.query.tenants.findFirst.mockResolvedValue(tenant);
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([null, { id: TOURNAMENT, tenantId: OTHER, status: 'live' }, { id: OTHER, tenantId: TENANT, status: 'live' }])('fails closed on missing/foreign parent %s', async parent => {
    fixture.mock.query.tournaments.findFirst.mockResolvedValue(parent);
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('hides a foreign match returned by a faulty adapter', async () => {
    fixture.match.tenantId = OTHER;
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('keeps explicitly parentless published friendlies readable', async () => {
    fixture.match.tournamentId = null;
    await expect(service.getPublicMatchState(TENANT, MATCH)).resolves.toMatchObject({ matchId: MATCH });
    expect(fixture.mock.query.tournaments.findFirst).not.toHaveBeenCalled();
  });
  it('does not mistake a missing parent column for a friendly', async () => {
    fixture.match.tournamentId = undefined;
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('validates IDs before reading', async () => {
    await expect(service.getPublicMatchState('invalid', MATCH)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('propagates publication lookup outages rather than treating them as public', async () => {
    fixture.mock.query.tournaments.findFirst.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.getPublicMatchState(TENANT, MATCH)).rejects.toThrow('Database unavailable');
  });
  it('validates history parentage and uses an explicit public column allowlist', async () => {
    await service.getBallHistory(TENANT, MATCH, INNINGS, 100);
    const options = fixture.mock.query.matchBalls.findMany.mock.calls[0][0];
    expect(dialect.sqlToQuery(options.where).params).toEqual([TENANT, MATCH, INNINGS]);
    expect(options.limit).toBe(100);
    expect(options.columns).not.toHaveProperty('clientOpId');
    expect(options.columns).not.toHaveProperty('actorId');
    expect(dialect.sqlToQuery(fixture.mock.query.matchInnings.findFirst.mock.calls[0][0].where).params).toEqual([INNINGS, MATCH, TENANT]);
  });
  it.each([null, { id: INNINGS, matchId: OTHER, tenantId: TENANT }, { id: INNINGS, matchId: MATCH, tenantId: OTHER }])('hides foreign/missing history innings %s', async innings => {
    fixture.mock.query.matchInnings.findFirst.mockResolvedValue(innings);
    await expect(service.getBallHistory(TENANT, MATCH, INNINGS, 100)).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.mock.query.matchBalls.findMany).not.toHaveBeenCalled();
  });
  it.each([0, 101, 1.5])('bounds history limit %s before reading', async limit => {
    await expect(service.getBallHistory(TENANT, MATCH, INNINGS, limit)).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('discovers commentary scope from the database, not a forged event tenant', async () => {
    expect(await service.publishedMatchTenant(MATCH)).toBe(TENANT);
    expect(fixture.mock.query.matches.findFirst).toHaveBeenCalledTimes(2);
  });
  it('checks publication for reaction authorization', async () => {
    fixture.match.status = 'cancelled';
    await expect(service.assertPublicMatch(TENANT, MATCH)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('uses distinct tenant-scoped room names', () => {
    expect(publicMatchRoom(TENANT, MATCH)).not.toBe(publicMatchRoom(OTHER, MATCH));
  });
});
