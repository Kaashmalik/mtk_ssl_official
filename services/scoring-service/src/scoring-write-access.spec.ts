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
const TOURNAMENT = '00000000-0000-4000-8000-000000000013';
const MATCH = '00000000-0000-4000-8000-000000000014';
const dialect = new PgDialect();
const match = { id: MATCH, tenantId: TENANT, tournamentId: null, scorerId: ACTOR, teamAId: TEAM_A, teamBId: TEAM_B };
const command = { matchId: TENANT, inningsId: TEAM_A, clientOpId: 'op', over: 0, ball: 1, runs: 0, batsmanId: BATTER, bowlerId: BOWLER };
function adapter() {
  const roster = new Map([
    [BATTER, { id: BATTER, tenantId: TENANT, teamId: TEAM_A, isActive: true, status: 'active' }],
    [BOWLER, { id: BOWLER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active' }],
    [FIELDER, { id: FIELDER, tenantId: TENANT, teamId: TEAM_B, isActive: true, status: 'active' }],
    [NONSTRIKER, { id: NONSTRIKER, tenantId: TENANT, teamId: TEAM_A, isActive: true, status: 'active' }],
  ]);
  const mock = { execute: jest.fn().mockResolvedValue([]), query: {
    users: { findFirst: jest.fn().mockResolvedValue({ id: ACTOR, isActive: true, role: 'league_owner' }) },
    userTenantRoles: { findFirst: jest.fn().mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'scorer', status: 'active' }) },
    tenants: { findFirst: jest.fn().mockResolvedValue({ id: TENANT, isActive: true }) },
    teams: { findFirst: jest.fn(async ({ where }) => ({ id: dialect.sqlToQuery(where).params[0], tenantId: TENANT, isActive: true })) },
    players: { findFirst: jest.fn(async ({ where }) => roster.get(String(dialect.sqlToQuery(where).params[0]))) },
    leagueRegistrations: { findMany: jest.fn().mockResolvedValue([]) },
    matchPlayingXis: { findMany: jest.fn().mockResolvedValue([]) },
  } };
  return { mock, tx: mock as unknown as ScoringTransaction, roster };
}

describe('Transactional actor membership and assignment', () => {
  it.each(['suspended', 'pending', undefined])('denies membership status %s despite active account and assignment', async (status) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'scorer', status });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('a platform role is not an operational league scoring grant', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'super_admin', status: 'active' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([undefined, { id: TENANT, isActive: false }, { id: TEAM_B, isActive: true }])('denies inactive/foreign league %s', async (tenant) => {
    const { mock, tx } = adapter();
    mock.query.tenants.findFirst.mockResolvedValue(tenant);
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.query.userTenantRoles.findFirst).not.toHaveBeenCalled();
  });
  it('uses match -> actor -> membership lock ordering and tenant-scoped role lookup', async () => {
    const { mock, tx } = adapter();
    await requireScoringWriteAccess(tx, TENANT, ACTOR, match);
    const locks = mock.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    expect(locks[0].sql).toContain('FOR UPDATE');
    expect(locks[0].params).toEqual([ACTOR]);
    expect(locks[1].sql).toContain('FOR SHARE');
    expect(locks[1].params).toEqual([TENANT]);
    expect(locks[2].sql).toContain('FOR SHARE');
    expect(locks[2].params).toEqual([ACTOR, TENANT]);
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
  it.each([null, 'other-actor'])('permits the current active backup with primary %s', async (scorerId) => {
    const { tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId, backupScorerId: ACTOR })).resolves.toBeUndefined();
  });
  it.each([null, undefined, 'other-actor'])('rejects a removed/foreign backup %s', async (backupScorerId) => {
    const { tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId: null, backupScorerId })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['suspended', 'pending'])('backup assignment cannot override membership status %s', async (status) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'scorer', status });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId: null, backupScorerId: ACTOR })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['fan', 'coach', 'team_manager', 'super_admin'])('backup assignment cannot override role %s', async (role) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role, status: 'active' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId: null, backupScorerId: ACTOR })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['fan', 'player', 'coach', 'team_manager', null])('junction role %s overrides legacy league-owner privilege', async (role) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role, status: 'active' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['league_owner'])('allows active exact-tenant %s oversight without assignment', async (role) => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role, status: 'active' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...match, scorerId: null })).resolves.toBeUndefined();
  });
  it('denies missing membership even if legacy arrays still grant access', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue(undefined);
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).rejects.toBeInstanceOf(ForbiddenException);
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

describe('Canonical registered-squad participant enforcement', () => {
  const tournamentMatch = { ...match, tournamentId: TOURNAMENT };
  const squads = () => [
    { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_A, status: 'approved', squadPlayerIds: [BATTER, NONSTRIKER] },
    { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_B, status: 'approved', squadPlayerIds: [BOWLER, FIELDER] },
  ];

  it('does not treat a missing tournament column as an explicitly parentless friendly', async () => {
    const { mock, tx } = adapter();
    await expect(requireDeliveryParticipants(tx, TENANT, { ...match, tournamentId: undefined } as never, TEAM_A, command)).rejects.toThrow('tournament context unavailable');
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it('permits all four participants only after registration locks and before player locks', async () => {
    const { mock, tx } = adapter();
    mock.query.leagueRegistrations.findMany.mockResolvedValue(squads());
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, {
      ...command, wicket: { type: 'run_out', playerId: NONSTRIKER, fielderId: FIELDER },
    })).resolves.toBeUndefined();
    const locks = mock.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    expect(locks).toHaveLength(3);
    expect(locks[0].sql).toContain('FROM "teams"');
    expect(locks[1].sql).toContain('FROM "league_registrations"');
    expect(locks[1].sql).toContain('ORDER BY');
    expect(locks[1].sql).toContain('LIMIT 3 FOR SHARE');
    expect(locks[1].params).toEqual([TENANT, TOURNAMENT, ...[TEAM_A, TEAM_B].sort()]);
    expect(locks[2].sql).toContain('FROM "players"');
    expect(locks.every(lock => !lock.sql.includes('FROM "tournaments"'))).toBe(true);
    const options = mock.query.leagueRegistrations.findMany.mock.calls[0][0];
    expect(dialect.sqlToQuery(options.where).params).toEqual(locks[1].params);
    expect(options.limit).toBe(3);
  });

  it.each(['batter', 'bowler', 'dismissed', 'fielder'] as const)('refuses an undeclared %s even when on the active team roster', async participant => {
    const { mock, tx } = adapter();
    const rows = squads();
    const id = { batter: BATTER, bowler: BOWLER, dismissed: NONSTRIKER, fielder: FIELDER }[participant];
    for (const row of rows) row.squadPlayerIds = row.squadPlayerIds.filter(player => player !== id);
    mock.query.leagueRegistrations.findMany.mockResolvedValue(rows);
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, {
      ...command, wicket: { type: 'run_out', playerId: NONSTRIKER, fielderId: FIELDER },
    })).rejects.toThrow('outside the approved tournament squad');
    expect(mock.query.players.findFirst).not.toHaveBeenCalled();
  });

  it.each(['pending', 'withdrawn', 'rejected', 'waitlisted'])('denies an existing %s registration rather than using a legacy fallback', async status => {
    const { mock, tx } = adapter();
    const rows = squads();
    rows[0].status = status;
    mock.query.leagueRegistrations.findMany.mockResolvedValue(rows);
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).rejects.toThrow('approved tournament squad');
  });

  it.each([{ squadPlayerIds: null }, { squadPlayerIds: [] }])('permits approved legacy squad $squadPlayerIds while retaining roster checks', async ({ squadPlayerIds }) => {
    const { mock, tx } = adapter();
    mock.query.leagueRegistrations.findMany.mockResolvedValue(squads().map(row => ({ ...row, squadPlayerIds })));
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).resolves.toBeUndefined();
    expect(mock.query.players.findFirst).toHaveBeenCalledTimes(2);
  });

  it('does not query registrations for a friendly and preserves missing-registration legacy matches', async () => {
    const { mock, tx } = adapter();
    await requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command);
    expect(mock.query.leagueRegistrations.findMany).not.toHaveBeenCalled();
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).resolves.toBeUndefined();
  });

  it.each([{ tenantId: TEAM_B }, { tournamentId: TEAM_B }, { teamId: ACTOR }])('rejects a remapped registration %s', async change => {
    const { mock, tx } = adapter();
    mock.query.leagueRegistrations.findMany.mockResolvedValue([{ ...squads()[0], ...change }]);
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).rejects.toThrow('require review');
  });

  it('rejects duplicate registration rows', async () => {
    const { mock, tx } = adapter();
    mock.query.leagueRegistrations.findMany.mockResolvedValue([squads()[0], squads()[0]]);
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).rejects.toThrow('require review');
  });

  it('does not treat a registration read outage as legacy eligibility', async () => {
    const { mock, tx } = adapter();
    mock.query.leagueRegistrations.findMany.mockRejectedValue(new Error('Registration read unavailable'));
    await expect(requireDeliveryParticipants(tx, TENANT, tournamentMatch, TEAM_A, command)).rejects.toThrow('Registration read unavailable');
    expect(mock.query.players.findFirst).not.toHaveBeenCalled();
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

describe('Declared playing-XI delivery gate (COMP-06)', () => {
  // Deterministic fillers keep every declared side at exactly 11 rows, with the
  // delivery participants spliced in ahead of them so orders stay 1..11.
  const filler = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const xiSquad = (teamId: string, start: number, extra: string[]) => {
    const ids = [...extra, ...Array.from({ length: 11 - extra.length }, (_, i) => filler(start + i))];
    return ids.map((playerId, i) => ({ teamId, playerId, battingOrder: i + 1 }));
  };
  const approvedXis = () => [
    ...xiSquad(TEAM_A, 100, [BATTER, NONSTRIKER]),
    ...xiSquad(TEAM_B, 200, [BOWLER, FIELDER]),
  ];

  it.each([
    ['a tournament match', { ...match, tournamentId: TOURNAMENT, xiRequired: true, xiApprovedAt: null }],
    ['a friendly', { ...match, xiRequired: true, xiApprovedAt: null }],
  ])('blocks deliveries while declared XIs await official approval on %s', async (_label, armed) => {
    const { mock, tx } = adapter();
    await expect(requireDeliveryParticipants(tx, TENANT, armed, TEAM_A, command))
      .rejects.toThrow('declared but not yet approved');
    expect(mock.query.matchPlayingXis.findMany).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed or future approval instant', async () => {
    const { tx } = adapter();
    await expect(requireDeliveryParticipants(tx, TENANT, { ...match, xiRequired: true, xiApprovedAt: 'not-a-date' }, TEAM_A, command))
      .rejects.toThrow('declared but not yet approved');
    await expect(requireDeliveryParticipants(tx, TENANT,
      { ...match, xiRequired: true, xiApprovedAt: new Date(Date.now() + 60_000) }, TEAM_A, command))
      .rejects.toThrow('declared but not yet approved');
  });

  it('admits participants present on their side\'s approved active XI', async () => {
    const { mock, tx } = adapter();
    mock.query.matchPlayingXis.findMany.mockResolvedValue(approvedXis());
    await expect(requireDeliveryParticipants(tx, TENANT,
      { ...match, xiRequired: true, xiApprovedAt: new Date(Date.now() - 1_000) }, TEAM_A, command))
      .resolves.toBe(new Set(approvedXis().filter(row => row.teamId === TEAM_A).map(row => row.playerId)).size);
    const options = mock.query.matchPlayingXis.findMany.mock.calls[0][0];
    const params = dialect.sqlToQuery(options.where).params;
    expect(params).toContain(TENANT);
    expect(params).toContain(MATCH);
    expect(options.columns).toEqual({ teamId: true, playerId: true, battingOrder: true });
  });

  it('admits the full wicket set against approved XIs', async () => {
    const { tx } = adapter();
    mockAdapterXis(tx, approvedXis());
    await expect(requireDeliveryParticipants(tx, TENANT,
      { ...match, xiRequired: true, xiApprovedAt: new Date(Date.now() - 1_000) }, TEAM_A, {
        ...command, wicket: { type: 'run_out', playerId: NONSTRIKER, fielderId: FIELDER },
      })).resolves.toBe(new Set(approvedXis().filter(row => row.teamId === TEAM_A).map(row => row.playerId)).size);
  });

  it.each([
    ['missing from the XI', (rows: ReturnType<typeof approvedXis>) => rows.filter(row => row.playerId !== BOWLER)],
    ['an incomplete declared side', (rows: ReturnType<typeof approvedXis>) => rows.slice(0, 5)],
  ])('refuses a participant %s even with an approved gate', async (_label, mutate) => {
    const { tx } = adapter();
    mockAdapterXis(tx, mutate(approvedXis()));
    await expect(requireDeliveryParticipants(tx, TENANT,
      { ...match, xiRequired: true, xiApprovedAt: new Date(Date.now() - 1_000) }, TEAM_A, command))
      .rejects.toThrow('outside the declared playing XI');
  });

  it('keeps legacy matches on registered-squad rules without touching XI rows', async () => {
    const { mock, tx } = adapter();
    await expect(requireDeliveryParticipants(tx, TENANT, { ...match, xiRequired: false, xiApprovedAt: null }, TEAM_A, command))
      .resolves.toBeUndefined();
    await expect(requireDeliveryParticipants(tx, TENANT, match, TEAM_A, command)).resolves.toBeUndefined();
    expect(mock.query.matchPlayingXis.findMany).not.toHaveBeenCalled();
  });

  function mockAdapterXis(tx: ScoringTransaction, rows: ReturnType<typeof approvedXis>) {
    (tx as unknown as { query: { matchPlayingXis: { findMany: jest.Mock } } }).query.matchPlayingXis.findMany
      .mockResolvedValue(rows);
  }
});


describe('Scorer handover writer fencing (SCORE-11)', () => {
  const fenced = { ...match, scorerHandoverEpoch: 2 };

  it('accepts tokenless writers only on an un-fenced match (epoch 0)', async () => {
    const { mock, tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, match)).resolves.toBeUndefined();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced)).rejects.toThrow('A scorer handover occurred');
    expect(mock.query.users.findFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts the current epoch and rejects a stale one before any lock', async () => {
    const { mock, tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced, 2)).resolves.toBeUndefined();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced, 1))
      .rejects.toThrow('A scorer handover occurred');
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced, 3))
      .rejects.toThrow('A scorer handover occurred');
    // The one accepted call passes the fence and locks user/tenant/membership;
    // both rejected calls are refused before any lock.
    expect(mock.query.users.findFirst).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledTimes(3);
  });

  it('fences even a re-verified scorer whose session missed the handover', async () => {
    const { mock, tx } = adapter();
    mock.query.userTenantRoles.findFirst.mockResolvedValue({ userId: ACTOR, tenantId: TENANT, role: 'scorer', status: 'active' });
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.query.userTenantRoles.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed on a corrupt token or epoch', async () => {
    const { mock, tx } = adapter();
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, fenced, 1.5))
      .rejects.toThrow('Invalid scoring session token');
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...fenced, scorerHandoverEpoch: 0.5 }, 1))
      .rejects.toThrow('handover epoch is corrupt');
    // An unread/null column keeps legacy behavior: epoch reads as 0, so a
    // tokenless writer on a pre-migration match keeps working.
    await expect(requireScoringWriteAccess(tx, TENANT, ACTOR, { ...fenced, scorerHandoverEpoch: null }, null))
      .resolves.toBeUndefined();
  });
});
