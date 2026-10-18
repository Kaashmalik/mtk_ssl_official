import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@mtk/database"
import { setPlayingXis, approvePlayingXis, substituteInPlayingXi } from "@/lib/match-records"

// Real schema tables, shared policies and withTenantContext pass through;
// only the db handle is mocked. Order-sensitive findFirst mocks dispatch by
// call order, which the writers make deterministic with ordered locks.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { transaction: vi.fn() },
}))

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const CLERK = "clerk_1"
const USER = T(1)
const TENANT = T(9)
const TOURNAMENT = T(10)
const MATCH = T(30)
const TEAM_A = T(21) // sorted before TEAM_B so ordered locks visit A first
const TEAM_B = T(22)

const xiPlayerIds = (start: number) => Array.from({ length: 11 }, (_, i) => T(start + i))
const A_PLAYERS = xiPlayerIds(101)
const B_PLAYERS = xiPlayerIds(201)
const xiEntries = (playerIds: string[]) => playerIds.map((playerId, i) => ({ playerId, battingOrder: i + 1 }))

function buildTx(options: {
  match?: Record<string, unknown>
  actor?: Record<string, unknown> | null
  member?: Record<string, unknown> | null
  registrations?: unknown[]
  xiCounts?: { teamId: string; declared: number }[]
  returningMatch?: Record<string, unknown>
  rosterOverrides?: Map<string, { teamId?: string; isActive?: boolean; status?: string }>
  activeXis?: { teamId: string; playerId: string; battingOrder: number }[]
} = {}) {
  const overrides = options.rosterOverrides
  const roster = [...A_PLAYERS.map(id => ({ id, teamId: TEAM_A })), ...B_PLAYERS.map(id => ({ id, teamId: TEAM_B }))]
    .map(player => ({ ...player, ...(overrides?.get(player.id) ?? {}) }))
  const teamQueue = [TEAM_A, TEAM_B]
  const execute = vi.fn().mockResolvedValue(undefined)
  const insertValues: unknown[] = []
  const matchUpdates: Record<string, unknown>[] = []
  const xiSupersedeWhere = vi.fn(async () => undefined)
  const tx = {
    execute,
    query: {
      matches: { findFirst: vi.fn(async () => options.match) },
      users: { findFirst: vi.fn(async () => options.actor ?? null) },
      tenants: { findFirst: vi.fn(async () => ({ id: TENANT, isActive: true })) },
      userTenantRoles: { findFirst: vi.fn(async () => options.member ?? null) },
      teams: { findFirst: vi.fn(async () => ({ id: teamQueue.shift(), tenantId: TENANT, isActive: true })) },
      leagueRegistrations: { findMany: vi.fn(async () => options.registrations ?? [
        { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_A, status: "approved", squadPlayerIds: null },
        { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_B, status: "approved", squadPlayerIds: null },
      ]) },
      matchPlayingXis: { findMany: vi.fn(async () => options.activeXis ?? [
        ...A_PLAYERS.map((playerId, i) => ({ teamId: TEAM_A, playerId, battingOrder: i + 1 })),
        ...B_PLAYERS.map((playerId, i) => ({ teamId: TEAM_B, playerId, battingOrder: i + 1 })),
      ]) },
      players: { findFirst: vi.fn(async () => {
        const next = roster.shift()
        return next ? { ...next, tenantId: TENANT, isActive: next.isActive ?? true, status: next.status ?? "active" } : null
      }) },
    },
    update: vi.fn((_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        if ("supersededAt" in vals) return { where: xiSupersedeWhere }
        matchUpdates.push(vals)
        return { where: () => ({ returning: async () => [options.returningMatch ?? { id: MATCH }] }) }
      },
    })),
    insert: vi.fn(() => ({ values: (vals: unknown) => {
      insertValues.push(vals)
      return Promise.resolve(undefined)
    } })),
    select: () => ({ from: () => ({ where: () => ({ groupBy: async () => options.xiCounts ?? [] }) }) }),
  }
  ;(db as unknown as { transaction: unknown }).transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx))
  return { execute, tx, matchUpdates, insertValues, xiSupersedeWhere }
}

const happyMatch = () => ({
  id: MATCH, tenantId: TENANT, tournamentId: TOURNAMENT, status: "scheduled",
  teamAId: TEAM_A, teamBId: TEAM_B, scorerId: T(40), backupScorerId: null,
  umpire1Id: null, umpire2Id: null, xiRequired: false, xiApprovedAt: null,
})

const ownerMember = () => ({ userId: USER, tenantId: TENANT, role: "league_owner", status: "active" })
const activeActor = () => ({ id: USER, clerkId: CLERK, isActive: true })

beforeEach(() => {
  ;(db as unknown as { transaction: unknown }).transaction = undefined
})

describe("setPlayingXis (COMP-06 slice)", () => {
  it("stores the wicketkeeper flag on exactly the designated slot and refuses a second", async () => {
    const txm = buildTx({ match: happyMatch(), actor: activeActor(), member: ownerMember() })

    const aEntries = xiEntries(A_PLAYERS).map((entry, i) => (i === 3 ? { ...entry, wicketkeeper: true } : entry))
    await setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: aEntries, teamBXi: xiEntries(B_PLAYERS),
    })

    const xiInsert = txm.insertValues[0] as Record<string, unknown>[]
    expect(xiInsert.filter((row: Record<string, unknown>) => row.wicketkeeper === true)).toHaveLength(1)
    expect(xiInsert.find((row: Record<string, unknown>) => row.wicketkeeper === true)).toMatchObject({
      teamId: TEAM_A, playerId: A_PLAYERS[3], battingOrder: 4,
    })
    // Undesignated slots and the other side read false - a non-flag is never "true".
    expect(xiInsert.every((row: Record<string, unknown>) =>
      row.wicketkeeper === true || row.wicketkeeper === false)).toBe(true)

    const twoKeepers = buildTx({ match: happyMatch(), actor: activeActor(), member: ownerMember() })
    const doubled = xiEntries(A_PLAYERS).map((entry, i) => (i === 0 || i === 1 ? { ...entry, wicketkeeper: true } : entry))
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: doubled, teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("cannot designate more than one wicketkeeper")
    expect(twoKeepers.insertValues).toHaveLength(0)
  })

  it("stores both sides, arms the requirement and clears any prior approval", async () => {
    const txm = buildTx({
      match: { ...happyMatch(), xiRequired: true, xiApprovedAt: new Date("2026-10-01T00:00:00Z") },
      actor: activeActor(), member: ownerMember(),
    })

    const result = await setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })

    expect(result).toEqual({ matchId: MATCH, declaredAt: expect.any(Date) })
    // Supersede first, then the 22 immutable rows, then the arming update.
    expect(txm.xiSupersedeWhere).toHaveBeenCalledTimes(1)
    const xiInsert = txm.insertValues[0] as Record<string, unknown>[]
    expect(xiInsert).toHaveLength(22)
    expect(xiInsert.every((row: Record<string, unknown>) => row.matchId === MATCH
      && row.tenantId === TENANT && row.declaredBy === USER)).toBe(true)
    expect(txm.matchUpdates[0]).toMatchObject({ xiRequired: true, xiApprovedAt: null })
    const audit = txm.insertValues[1] as Record<string, unknown>
    expect(audit.method).toBe("XI_DECLARE")
  })

  it("refuses a friendly, a mid-match re-declaration and an invalid squad shape before any write", async () => {
    const friendly = buildTx({ match: { ...happyMatch(), tournamentId: null }, actor: activeActor(), member: ownerMember() })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("competition matches only")
    expect(friendly.matchUpdates).toHaveLength(0)

    buildTx({ match: { ...happyMatch(), status: "live" }, actor: activeActor(), member: ownerMember() })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("only be declared while the match is scheduled")

    const short = buildTx({ match: happyMatch(), actor: activeActor(), member: ownerMember() })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS).slice(0, 10), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("exactly 11 players")
    expect(short.insertValues).toHaveLength(0)
    expect(short.matchUpdates).toHaveLength(0)
  })

  it("fails closed on a non-approved registration squad without writing", async () => {
    const txm = buildTx({
      match: happyMatch(), actor: activeActor(), member: ownerMember(),
      registrations: [
        { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_A, status: "pending", squadPlayerIds: A_PLAYERS },
        { tenantId: TENANT, tournamentId: TOURNAMENT, teamId: TEAM_B, status: "approved", squadPlayerIds: B_PLAYERS },
      ],
    })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("outside the approved tournament squad")
    expect(txm.matchUpdates).toHaveLength(0)
    expect(txm.insertValues).toHaveLength(0)
  })

  it("refuses a declared player who is not an active roster member of that side", async () => {
    const txm = buildTx({
      match: happyMatch(), actor: activeActor(), member: ownerMember(),
      rosterOverrides: new Map([[A_PLAYERS[0], { teamId: TEAM_B }]]),
    })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("does not belong to that side")
    expect(txm.insertValues).toHaveLength(0)
  })

  it("only the owner or an assigned scorer may declare", async () => {
    const txm = buildTx({
      match: happyMatch(), actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "fan", status: "active" },
    })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).rejects.toThrow("only the owner or the assigned scorer")
    expect(txm.insertValues).toHaveLength(0)

    // The assigned primary scorer may declare even as a scorer role.
    const scorerTx = buildTx({
      match: { ...happyMatch(), scorerId: USER },
      actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "scorer", status: "active" },
    })
    await expect(setPlayingXis({
      userId: CLERK, tenantId: TENANT, matchId: MATCH,
      teamAXi: xiEntries(A_PLAYERS), teamBXi: xiEntries(B_PLAYERS),
    })).resolves.toEqual({ matchId: MATCH, declaredAt: expect.any(Date) })
    expect(scorerTx.matchUpdates[0]).toMatchObject({ xiRequired: true })
  })
})

describe("approvePlayingXis (COMP-06 slice)", () => {
  it("an owner approves armed, complete and unapproved XIs via conditional update", async () => {
    const txm = buildTx({
      match: { ...happyMatch(), xiRequired: true }, actor: activeActor(), member: ownerMember(),
      xiCounts: [{ teamId: TEAM_A, declared: 11 }, { teamId: TEAM_B, declared: 11 }],
    })

    const result = await approvePlayingXis({ userId: CLERK, tenantId: TENANT, matchId: MATCH })

    expect(result).toEqual({ matchId: MATCH, approvedAt: expect.any(Date) })
    expect(txm.matchUpdates[0]).toEqual({
      xiApprovedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
    const audit = txm.insertValues[0] as Record<string, unknown>
    expect(audit.method).toBe("XI_APPROVE")
  })

  it("an assigned member umpire may approve; an unrelated role may not", async () => {
    buildTx({
      match: { ...happyMatch(), xiRequired: true, umpire1Id: USER, umpire2Id: null },
      actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "player", status: "active" },
      xiCounts: [{ teamId: TEAM_A, declared: 11 }, { teamId: TEAM_B, declared: 11 }],
    })
    await expect(approvePlayingXis({ userId: CLERK, tenantId: TENANT, matchId: MATCH }))
      .resolves.toEqual({ matchId: MATCH, approvedAt: expect.any(Date) })

    const outsider = buildTx({
      match: { ...happyMatch(), xiRequired: true, umpire1Id: T(41), umpire2Id: null },
      actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "player", status: "active" },
    })
    await expect(approvePlayingXis({ userId: CLERK, tenantId: TENANT, matchId: MATCH }))
      .rejects.toThrow("owner or an assigned member umpire")
    expect(outsider.matchUpdates).toHaveLength(0)
  })

  it.each([
    ["no declared XIs", { xiRequired: false }, [{ teamId: TEAM_A, declared: 11 }, { teamId: TEAM_B, declared: 11 }]],
    ["already approved", { xiRequired: true, xiApprovedAt: new Date() }, [{ teamId: TEAM_A, declared: 11 }, { teamId: TEAM_B, declared: 11 }]],
    ["an incomplete declared side", { xiRequired: true }, [{ teamId: TEAM_A, declared: 11 }]],
    ["a short declared side", { xiRequired: true }, [{ teamId: TEAM_A, declared: 10 }, { teamId: TEAM_B, declared: 11 }]],
  ])("refuses %s before any approval write", async (_label, matchOverride, counts) => {
    const txm = buildTx({
      match: { ...happyMatch(), ...matchOverride },
      actor: activeActor(), member: ownerMember(), xiCounts: counts,
    })
    await expect(approvePlayingXis({ userId: CLERK, tenantId: TENANT, matchId: MATCH })).rejects.toThrow()
    expect(txm.matchUpdates).toHaveLength(0)
  })})

describe("substituteInPlayingXi (SCORE-10)", () => {
  const armedMatch = () => ({ ...happyMatch(), xiRequired: true })

  it("a keeper substitution hands the designation to the incoming player, audited", async () => {
    const txm = buildTx({ match: armedMatch(), actor: activeActor(), member: ownerMember(),
      activeXis: [
        ...A_PLAYERS.map((playerId, i) => ({ teamId: TEAM_A, playerId, battingOrder: i + 1, wicketkeeper: i === 2 })),
        ...B_PLAYERS.map((playerId, i) => ({ teamId: TEAM_B, playerId, battingOrder: i + 1 })),
      ] })
    ;(txm.tx.query.players.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: T(50), tenantId: TENANT, teamId: TEAM_A, isActive: true, status: "active" })

    await substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })

    const xiInsert = txm.insertValues[0] as Record<string, unknown>
    expect(xiInsert).toMatchObject({ playerId: T(50), battingOrder: 3, wicketkeeper: true })
    const audit = txm.insertValues[1] as Record<string, unknown>
    expect(audit.payload).toMatchObject({ keeperHandover: true })

    // The same substitution of a NON-keeper carries no designation.
    const plain = buildTx({ match: armedMatch(), actor: activeActor(), member: ownerMember() })
    ;(plain.tx.query.players.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: T(50), tenantId: TENANT, teamId: TEAM_A, isActive: true, status: "active" })
    await substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })
    expect((plain.insertValues[0] as Record<string, unknown>).wicketkeeper).toBe(false)
    expect((plain.insertValues[1] as Record<string, unknown>).payload).toMatchObject({ keeperHandover: false })
  })

  it("supersedes the outgoing declaration, inherits the slot and keeps the approval intact", async () => {
    const txm = buildTx({ match: { ...armedMatch(), xiApprovedAt: new Date("2026-10-17T10:00:00Z") },
      actor: activeActor(), member: ownerMember() })
    ;(txm.tx.query.players.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: T(50), tenantId: TENANT, teamId: TEAM_A, isActive: true, status: "active" })

    const result = await substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })

    expect(result).toEqual({ matchId: MATCH, teamId: TEAM_A, battingOrder: 3, substitutedAt: expect.any(Date) })
    expect(txm.xiSupersedeWhere).toHaveBeenCalledTimes(1)
    const xiInsert = txm.insertValues[0] as Record<string, unknown>
    expect(xiInsert).toMatchObject({ matchId: MATCH, teamId: TEAM_A, playerId: T(50), battingOrder: 3 })
    // An official substitution act never re-opens the approval gate.
    expect(txm.matchUpdates).toHaveLength(0)
    const audit = txm.insertValues[1] as Record<string, unknown>
    expect(audit.method).toBe("XI_SUBSTITUTE")
    expect(audit.payload).toMatchObject({ outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50), battingOrder: 3 })
  })

  it("refuses an unmatched pair, a cross-side or duplicate replacement before any write", async () => {
    const txm = buildTx({ match: armedMatch(), actor: activeActor(), member: ownerMember() })
    ;(txm.tx.query.players.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: T(50), tenantId: TENANT, teamId: TEAM_A, isActive: true, status: "active" })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: A_PLAYERS[4],
    })).rejects.toThrow("already in the declared playing XI")
    expect(txm.xiSupersedeWhere).not.toHaveBeenCalled()

    const cross = buildTx({ match: armedMatch(), actor: activeActor(), member: ownerMember() })
    ;(cross.tx.query.players.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: B_PLAYERS[0], tenantId: TENANT, teamId: TEAM_A, isActive: true, status: "active" })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: B_PLAYERS[0],
    })).rejects.toThrow("declared for the other side")

    const missing = buildTx({ match: armedMatch(), actor: activeActor(), member: ownerMember() })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: T(50), incomingPlayerId: A_PLAYERS[4],
    })).rejects.toThrow("not in the declared playing XI")
    expect(missing.insertValues).toHaveLength(0)
  })

  it("is official-only, gate-only and closes with the match", async () => {
    const outsider = buildTx({
      match: armedMatch(), actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "fan", status: "active" },
    })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })).rejects.toThrow("assigned member umpire may substitute")
    expect(outsider.insertValues).toHaveLength(0)

    buildTx({ match: happyMatch(), actor: activeActor(), member: ownerMember() })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })).rejects.toThrow("no declared XIs")

    buildTx({ match: { ...armedMatch(), status: "completed" }, actor: activeActor(), member: ownerMember() })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })).rejects.toThrow("closed for this match status")

    // A player-role member without an umpire slot is rejected by the slot check.
    buildTx({
      match: armedMatch(),
      actor: activeActor(),
      member: { userId: USER, tenantId: TENANT, role: "player", status: "active" },
    })
    await expect(substituteInPlayingXi({
      userId: CLERK, tenantId: TENANT, matchId: MATCH, teamId: TEAM_A,
      outgoingPlayerId: A_PLAYERS[2], incomingPlayerId: T(50),
    })).rejects.toThrow("assigned member umpire may substitute")
  })
})
