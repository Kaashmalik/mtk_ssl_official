import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import { requireScoringWriteAccess, requireDeliveryParticipants, type ScoringTransaction } from './scoring-write-access';

jest.mock('@mtk/database/client', () => ({ db: {}, queryClient: {}, migrationClient: {} }));

const TENANT = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-7000-8000-000000000006';
const TEAM_A = '00000000-0000-4000-8000-000000000007';
const TEAM_B = '00000000-0000-4000-8000-000000000008';
const BATTER = '00000000-0000-4000-8000-000000000009';
const BOWLER = '00000000-0000-4000-8000-000000000010';
const FIELDER = '00000000-0000-4000-8000-000000000011';
const NONSTRIKER = '00000000-0000-4000-8000-000000000012';
const dialect = new PgDialect();
const match = { tenantId: TENANT, scorerId: ACTOR, teamAId: TEAM_A, teamBId: TEAM_B };
const command = { matchId: TENANT, inningsId: TEAM_A, clientOpId: 'op', over: 0, ball: 1, runs: 0, batsmanId: BATTER, bowlerId: BOWLER };
function adapter() {
  const roster = new Map([
    [BATTER, { id: BATTER, tenantId: TENANT, teamId: TEAM_A, isActive: true, status: 'active' }],
    [BOWLER, { id: BOWLER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active' }],
    [FIELDER, { id: FIELDER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active' }],
    [NONSTRIKER, { id: NONSTRIKER, tenantId: TENANT, teamId: TEAM_A, isActive: true, status: 'active' }],
  ]);
  const mock = { execute: jest.fn().mockResolvedValue([]), query: {
    users: { findFirst: jest.fn().mockResolvedValue({ id: ACTOR, isActive: true, role: 'league_owner', tenantIds: [TENANT] }) },
    userTenantRoles: { findFirst: jest.fn().mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'scorer' }) },
    teams: { findFirst: jest.fn(async ({ where }) => ({ id: dialect.sqlToQuery(where).params[0], tenantId: TENANT, isActive: true })) },
    players: { findFirst: jest.fn(async ({ where }) => roster.get(String(dialect.sqlToQuery(where).params[0]))) },
  } };
  return { mock, tx: mock as unknown as ScoringTransaction, roster };
}

describe('Transactional actor membership and assignment', () => {
  it('uses match -> actor -> membership lock ordering and tenant-scoped role lookup', async () => {
    const { mock, tx } = adapter();
    await requireScoringWriteAccess(tx, TENANT, ACTOR, match);
    const locks = mock.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    expect(locks[0].sql).toContain('FOR UPDATE');
    expect(locks[0].params).toEqual([ACTOR]);
    expect(locks[1].sql).toContain('FOR SHARE');
    expect(locks[1].params).toEqual([ACTOR, TENANT]);
    expect(dialect.sqlToQuery(mock.query.userTenantRoles.findFirst.mock.calls[0][0].where).params).toEqual([ACTOR, TENANT]);
  });
  it.each([undefined, { id: ACTOR, isActive: false }, { id: 'someone-else', isActive: true }])('denies unavailable or mismatched actor %s', async (actor) => {
    const { mock, tx } = adapter();
    mock.query.users.findFirst.mockResolvedValue(actor);
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.query.userTenantRoles.findFirst).not.toHaveBeenCalled();
  });
  it.each([null, 'other-actor'])('denies revoked assignment %s even with stale web authorization', async (scorerId) => {
    const { tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['fan', 'player', 'coach', 'team_manager', null])('junction role %s overrides legacy league-owner privilege', async (role) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['league_owner', 'super_admin'])('allows active exact-tenant %s oversight without assignment', async (role) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId: null })).resolves.toBeUndefined();
  });
  it('allows legacy membership only when the exact-tenant junction row is absent', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue(undefined);
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).resolves.toBeUndefined();
    mock.query.users.findFirst.mockResolvedValue({ id: ACTOR, isActive: true, role: 'scorer', tenantIds: [TEAM_B] });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not turn a failed role query into privileged legacy fallback', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockRejectedValue(new Error('Role table unavailable'));
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toThrow('Role table unavailable');
  });

  it('rejects foreign-tenant membership even when returned by an adapter', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TEAM_B, role: 'league_owner' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects missing actor and foreign match context before identity queries', async () => {
    const { mock, tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, undefined as never, match)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, tenantId: TEAM_B })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.execute).not.toHaveBeenCalled();
  });
});

describe('Tenant-scoped delivery participants', () => {
  it('locks team/player rows in deterministic order, keeping eligibility stable until commit', async () => {
    const { mock, tx } = adapter();
    await requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command);
    for (const [query] of mock.execute.mock.calls) {
      const lock = dialect.sqlToQuery(query);
      expect(lock.sql).toContain('ORDER BY');
      expect(lock.sql).toContain('FOR SHARE');
      expect(lock.params[0]).toBe(TENANT);
    }
    for (const [options] of mock.query.players.findFirst.mock.calls) expect(dialect.sqlToQuery(options.where).params[1]).toBe(TENANT);
  });
  it.each([{ isActive: false }, { status: 'suspended' }, { status: 'injured' }, { teamId: TEAM_B }])('denies ineligible batting player %s', async (change) => {
    const { tx, roster } = adapter();
    Object.assign(roster.get(BATTER)!, change);
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a foreign-tenant player even if a broken adapter returns it', async () => {
    const { tx, roster } = adapter();
    roster.get(BATTER)!.tenantId = TEAM_B;
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects missing players and third-team innings', async () => {
    const { tx, roster } = adapter();
    roster.delete(BATTER);
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).rejects.toBeInstanceOf(NotFoundException);
    await expect(requireDeliveryParticipants(tx, TENANT, match, ACTOR, command)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('checks bowler side and prevents one ID from being both batter and bowler', async () => {
    const { tx, roster } = adapter();
    roster.get(BOWLER)!.teamId = TEAM_A;
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).rejects.toBeInstanceOf(BadRequestException);
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, { ...command, bowlerId: BATTER })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('validates dismissed player and fielder without excluding non-striker run-outs', async () => {
    const { tx } = adapter();
    const wicket = { type: 'run_out' as const, playerId: NONSTRIKER, fielderId: FIELDER };
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, { ...command, wicket })).resolves.toBeUndefined();
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, { ...command,
      wicket: { ...wicket, type: 'caught' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, { ...command,
      wicket: { ...wicket, fielderId: BATTER } })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([undefined, { id: TEAM_A, tenantId: TEAM_B, isActive: true }, { id: TEAM_A, tenantId: TENANT, isActive: false }])('rejects unavailable or foreign teams %s', async (team) => {
    const { mock, tx } = adapter();
    mock.query.teams.findFirst.mockResolvedValue(team as never);
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).rejects.toThrow();
    expect(mock.query.players.findFirst).not.toHaveBeenCalled();
  });
});
