import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { players, tenants, teams } from "@mtk/database"
import {
  findExistingPlayerIdCard, getLeagueSlug, idPrefix, issuePlayerIdCard,
  listIssuedPlayerIdCards, playerIdListLimit, requirePlayerInLeague,
  revokePlayerIdCard, setPlayerIdCardExpiry,
} from "@/lib/player-id-cards"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  queries: [] as any[],
  state: {
    players: [] as any[],
    tenants: [] as any[],
    // each playerIds table select pops the next result set (flows hit it twice)
    playerIdsLookupQueue: [] as any[][],
    issuedRows: [] as any[],
    teamRows: [] as any[],
    updatedReturning: [] as any[],
    insertedCard: null as any,
    insertFailsWithUniqueViolation: false,
    rawResults: [] as any[],
  },
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const PLAYER = "00000000-0000-4000-8000-000000000002"
const dialect = new PgDialect()

interface QueryRecord {
  table?: unknown
  joined?: unknown
  params: unknown[]
  limit?: number
  kind: "select" | "update"
  setValues?: Record<string, unknown>
}

function selectChain() {
  const record: QueryRecord = { kind: "select", params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    innerJoin: (_table: any, _on: any) => { record.joined = players; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => {
      // The issued-list select joins the players table into the projection.
      let rows: any[]
      if (record.joined) rows = mocks.state.issuedRows
      else if (record.table === players) rows = mocks.state.players
      else if (record.table === tenants) rows = mocks.state.tenants
      else if (record.table === teams) rows = mocks.state.teamRows
      else rows = mocks.state.playerIdsLookupQueue.shift() ?? []
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
  return chain
}

function updateChain() {
  const record: QueryRecord = { kind: "update", params: [] }
  mocks.queries.push(record)
  const chain: any = {
    set: (values: any) => { record.setValues = values; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    returning: () => Promise.resolve(mocks.state.updatedReturning),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    players: [], tenants: [], playerIdsLookupQueue: [], issuedRows: [], teamRows: [],
    updatedReturning: [], insertedCard: null, insertFailsWithUniqueViolation: false, rawResults: [],
  }
  mocks.select.mockImplementation(selectChain)
  mocks.update.mockImplementation(updateChain)
  mocks.transaction.mockImplementation(async (fn: any) => {
    const tx = {
      execute: async () => mocks.state.rawResults.shift() ?? [{ nextSeq: 1 }],
      insert: () => ({
        values: () => ({
          returning: async () => {
            if (mocks.state.insertFailsWithUniqueViolation) {
              const dup: any = new Error(
                'duplicate key value violates unique constraint "player_ids_player_id_tenant_id_unique"',
              )
              dup.code = "23505"
              throw dup
            }
            if (!mocks.state.insertedCard) throw new Error("insert ran outside a seeded test")
            return [mocks.state.insertedCard]
          },
        }),
      }),
    }
    return fn(tx)
  })
})

describe("player id cards are scoped to the exact league", () => {
  it("finds an existing card only within the league", async () => {
    mocks.state.playerIdsLookupQueue = [[{ id: "card-1", tenantId: TENANT, playerId: PLAYER }]]
    const result = await findExistingPlayerIdCard(PLAYER, TENANT)
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
    expect(mocks.queries[0].params).not.toContain(OTHER_TENANT)
    expect(result?.id).toBe("card-1")
  })

  it("rejects a player from a foreign league", async () => {
    mocks.state.players = []
    await expect(requirePlayerInLeague(PLAYER, TENANT)).rejects.toThrow("Player not found")
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
  })

  it("resolves the id prefix from the league slug", async () => {
    mocks.state.tenants = [{ slug: "shakir-super-league" }]
    expect(await getLeagueSlug(TENANT)).toBe("shakir-super-league")
    expect(mocks.queries[0].params).toEqual([TENANT])
    expect(idPrefix("shakir-super-league")).toBe("SHAKI")
    expect(idPrefix("ssl")).toBe("SSL")
    expect(idPrefix("!!")).toBe("SSL")
  })

  it("predicates the list projection on the league for the join and team names", async () => {
    mocks.state.issuedRows = [
      { id: "c1", formattedId: "SSL-2026-0001", teamId: "t1", playerName: "Ali", tenantId: TENANT },
      { id: "c2", formattedId: "SSL-2026-0002", teamId: "t2", playerName: "Bilal", tenantId: TENANT },
    ]
    mocks.state.teamRows = [{ id: "t1", name: "Lions" }, { id: "t2", name: "Falcons" }]
    const rows = await listIssuedPlayerIdCards(TENANT)
    expect(mocks.queries[0].params).toEqual([TENANT, TENANT])
    expect(mocks.queries[1].params).toEqual(["t1", "t2", TENANT])
    expect(rows[0].teamName).toBe("Lions")
    expect(rows[1].teamName).toBe("Falcons")
  })

  it("caps the issued list at the documented bound", async () => {
    mocks.state.issuedRows = []
    await listIssuedPlayerIdCards(TENANT)
    expect(mocks.queries[0].limit).toBe(playerIdListLimit)
    expect(playerIdListLimit).toBe(200)
  })

  it("revokes only within the league and reports a missing card", async () => {
    mocks.state.updatedReturning = [{ id: "c1" }]
    expect(await revokePlayerIdCard(PLAYER, TENANT)).toBe(true)
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])

    mocks.state.updatedReturning = []
    expect(await revokePlayerIdCard(PLAYER, TENANT)).toBe(false)
  })

  it("sets expiry inside the league", async () => {
    mocks.state.updatedReturning = [{ id: "c1" }]
    const expiry = new Date("2026-12-31T00:00:00Z")
    expect(await setPlayerIdCardExpiry(PLAYER, TENANT, expiry)).toBe(true)
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
    expect(mocks.queries[0].setValues).toEqual({ expiryDate: expiry })
  })
})

describe("issuePlayerIdCard serializes allocation under an advisory lock", () => {
  it("allocates the next sequence in one locked transaction with a formatted id", async () => {
    mocks.state.players = [{ id: PLAYER }]
    mocks.state.tenants = [{ slug: "ssl" }]
    mocks.state.playerIdsLookupQueue = [[]]
    mocks.state.rawResults = [[{ nextSeq: 7 }]] // first tx.execute consumes the lock; second returns 7
    mocks.state.insertedCard = {
      id: "c1", tenantId: TENANT, playerId: PLAYER, prefix: "SSL", year: 2026,
      sequenceNumber: 7, formattedId: "SSL-2026-0007",
    }

    const result = await issuePlayerIdCard({ tenantId: TENANT, playerId: PLAYER })

    // Flow: player lookup -> league slug -> existing-card check
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
    expect(mocks.queries[2].params).toEqual([PLAYER, TENANT])
    expect(result.action).toBe("created")
    expect(result.card.formattedId).toBe("SSL-2026-0007")
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it("returns the existing card without allocating", async () => {
    mocks.state.players = [{ id: PLAYER }]
    mocks.state.tenants = [{ slug: "ssl" }]
    mocks.state.playerIdsLookupQueue = [[{ id: "c1", sequenceNumber: 1, tenantId: TENANT, playerId: PLAYER }]]

    const result = await issuePlayerIdCard({ tenantId: TENANT, playerId: PLAYER })
    const existing = { id: "c1", sequenceNumber: 1, tenantId: TENANT, playerId: PLAYER }
    expect(result).toEqual({ action: "existing", card: existing })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("recovers the winning card when a concurrent issuance claims the row", async () => {
    const winner = { id: "c1", sequenceNumber: 4, tenantId: TENANT, playerId: PLAYER }
    mocks.state.players = [{ id: PLAYER }]
    mocks.state.tenants = [{ slug: "ssl" }]
    // First playerIds lookup: no card yet. After the insert races: the winner.
    mocks.state.playerIdsLookupQueue = [[], [winner]]
    // The concurrent issuer wins the UNIQUE (player_id, tenant_id) insert.
    mocks.state.insertFailsWithUniqueViolation = true
    mocks.state.rawResults = []

    const result = await issuePlayerIdCard({ tenantId: TENANT, playerId: PLAYER })
    expect(result.action).toBe("raced")
    expect(result.card).toBe(winner)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})
