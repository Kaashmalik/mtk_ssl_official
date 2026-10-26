import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-10-01: chat retention. The purge is irreversible, so: the cron is
 * secret-guarded, the worker is gated OFF by default, and when on it deletes
 * only the bounded batch of ids it selected - never an unscoped DELETE.
 */

const mocks = vi.hoisted(() => {
  const selects: unknown[][] = []
  const deletes: { table: unknown; where: unknown }[] = []
  // Rows are handed out when a query EXECUTES (.limit), not when select() is
  // called: the open-report subquery is built with select() but never runs.
  const chain = () => {
    const c: Record<string, unknown> = {}
    for (const k of ["from", "where", "orderBy"]) c[k] = vi.fn(() => c)
    c.limit = vi.fn(async () => selects.shift() ?? [])
    return c
  }
  return {
    selects,
    deletes,
    db: {
      select: vi.fn(() => chain()),
      delete: vi.fn((table: unknown) => ({
        where: vi.fn((where: unknown) => {
          deletes.push({ table, where })
          return { returning: vi.fn(async () => [{ id: "x" }, { id: "y" }].slice(0, deletes.length === 1 ? 2 : 1)) }
        }),
      })),
    },
  }
})

vi.mock("@mtk/database", () => ({
  db: mocks.db,
  matchChatMessages: { id: "m.id", status: "m.status", createdAt: "m.created_at" },
  matchChatMutes: { id: "u.id", mutedUntil: "u.muted_until" },
  matchChatReports: { id: "r.id", messageId: "r.message_id", status: "r.status" },
}))

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  or: (...a: unknown[]) => ({ or: a }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ lt: [a, b] }),
  asc: (a: unknown) => ({ asc: a }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  notExists: (a: unknown) => ({ notExists: a }),
}))

beforeEach(() => {
  mocks.selects.length = 0
  mocks.deletes.length = 0
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllEnvs())

describe("purgeExpiredChat", () => {
  it("does nothing at all while the retention gate is off", async () => {
    const { purgeExpiredChat } = await import("@/lib/match-chat-retention")
    expect(await purgeExpiredChat()).toEqual({ ran: false, reason: "gate_off" })
    expect(mocks.db.select).not.toHaveBeenCalled()
    expect(mocks.db.delete).not.toHaveBeenCalled()
  })

  it("deletes exactly the selected ids, never an unscoped table", async () => {
    vi.stubEnv("MATCH_CHAT_RETENTION_READY", "1")
    mocks.selects.push([{ id: "a" }, { id: "b" }], [{ id: "mute-1" }])
    const { purgeExpiredChat } = await import("@/lib/match-chat-retention")
    const result = await purgeExpiredChat(new Date("2026-10-27T00:00:00Z"))
    expect(result).toEqual({ ran: true, messagesDeleted: 2, mutesDeleted: 1, batchLimit: 500 })
    expect(mocks.deletes).toEqual([
      { table: expect.objectContaining({ id: "m.id" }), where: { inArray: ["m.id", ["a", "b"]] } },
      { table: expect.objectContaining({ id: "u.id" }), where: { inArray: ["u.id", ["mute-1"]] } },
    ])
  })

  it("skips the delete entirely when nothing has expired", async () => {
    vi.stubEnv("MATCH_CHAT_RETENTION_READY", "1")
    mocks.selects.push([], [])
    const { purgeExpiredChat } = await import("@/lib/match-chat-retention")
    expect(await purgeExpiredChat()).toMatchObject({ ran: true, messagesDeleted: 0, mutesDeleted: 0 })
    expect(mocks.db.delete).not.toHaveBeenCalled()
  })

  it("only ever accepts the exact opt-in value", async () => {
    vi.stubEnv("MATCH_CHAT_RETENTION_READY", "true")
    const { chatRetentionReady } = await import("@/lib/match-chat-retention")
    expect(chatRetentionReady()).toBe(false)
  })
})

describe("GET /api/cron/chat-retention", () => {
  const req = (authorization?: string) =>
    new Request("https://app.test/api/cron/chat-retention", { headers: authorization ? { authorization } : {} })

  it("fails closed without a configured secret and rejects a wrong one", async () => {
    const { GET } = await import("@/app/api/cron/chat-retention/route")
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(req("Bearer x"))).status).toBe(503)
    vi.stubEnv("CRON_SECRET", "cron-secret")
    expect((await GET(req("Bearer wrong"))).status).toBe(401)
    expect(mocks.db.select).not.toHaveBeenCalled()
  })

  it("reports a gated no-op with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    const { GET } = await import("@/app/api/cron/chat-retention/route")
    const res = await GET(req("Bearer cron-secret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ran: false, reason: "gate_off" })
  })
})
