import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  listNotificationJobDeadLetters,
  resolveNotificationJob,
  retryNotificationJob,
} from "@/lib/notification-jobs-admin"

/**
 * ENH-06-04: dead-letter head inspection, retry and resolution.
 *
 * Inspection is tenant-scoped (an omitted tenant is the platform head, never a
 * wildcard produced by a league call). Retry resets the attempt ladder only for
 * a truly dead-lettered row; resolve is the honest terminal outcome. Both write
 * an audit row.
 */

const mocks = vi.hoisted(() => ({
  row: null as any,
  updated: [{ id: "job-1", state: "pending" }] as any[],
  transaction: vi.fn(),
  listSelect: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    transaction: mocks.transaction,
    select: mocks.listSelect,
  },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const JOB = "00000000-0000-4000-8000-0000000000c1"
const ACTOR = "00000000-0000-4000-8000-0000000000d1"
const dialect = new PgDialect()

type Captured = {
  listWhere?: unknown
  listLimit?: number
  lockWhere?: unknown
  updateSet?: Record<string, unknown>
  audit?: Record<string, unknown>
}

const DEAD = {
  id: JOB, tenantId: TENANT, eventId: "match:m1:started", recipientUserId: ACTOR,
  state: "dead_lettered", attempts: 8, lastError: "provider_http_500",
}

function harness(row: any = DEAD, updated: any[] = [{ id: JOB, state: "pending" }]) {
  const captured: Captured = {}
  mocks.row = row
  mocks.updated = updated

  mocks.listSelect.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: (where: unknown) => { captured.listWhere = where; return chain },
      orderBy: () => chain,
      limit: (limit: number) => { captured.listLimit = limit; return Promise.resolve([row]) },
    }
    return chain
  })

  const tx = {
    select: () => {
      const chain: any = {
        from: () => chain,
        where: (where: unknown) => { captured.lockWhere = where; return chain },
        for: () => chain,
        limit: () => Promise.resolve(mocks.row ? [mocks.row] : []),
      }
      return chain
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.updateSet = values
        return { where: () => ({ returning: async () => mocks.updated }) }
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.audit = values
        return Promise.resolve()
      },
    }),
  }
  mocks.transaction.mockImplementation(async (fn: any) => fn(tx))
  return captured
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("ENH-06-04: dead-letter inspection", () => {
  it("reads only dead-lettered rows, newest first, bounded to the head", async () => {
    const captured = harness()
    await listNotificationJobDeadLetters({ tenantId: TENANT, limit: 25 })

    const params = dialect.sqlToQuery(captured.listWhere as any).params
    expect(params).toContain("dead_lettered")
    expect(params).toContain(TENANT)
    expect(captured.listLimit).toBe(25)
  })

  it("omitting the tenant means the platform head, not an implicit wildcard from a league call", async () => {
    const captured = harness()
    await listNotificationJobDeadLetters()

    const params = dialect.sqlToQuery(captured.listWhere as any).params
    expect(params).toContain("dead_lettered")
    expect(params).not.toContain(TENANT)
    expect(captured.listLimit).toBe(100)
  })

  it("refuses an unbounded or malformed limit", async () => {
    harness()
    await expect(listNotificationJobDeadLetters({ limit: 201 })).rejects.toThrow()
    await expect(listNotificationJobDeadLetters({ limit: 0 })).rejects.toThrow()
    await expect(listNotificationJobDeadLetters({ tenantId: "nope" })).rejects.toThrow()
  })
})

describe("ENH-06-04: dead-letter retry and resolution", () => {
  it("requeues a dead letter from a clean attempt ladder and audits the operator", async () => {
    const captured = harness(DEAD, [{ id: JOB, state: "pending" }])

    const result = await retryNotificationJob({ id: JOB, tenantId: TENANT, actorId: ACTOR, actorRole: "super_admin" })

    expect(result).toEqual({ ok: true, id: JOB, state: "pending" })
    expect(captured.updateSet).toMatchObject({ state: "pending", attempts: 0, leaseToken: null, resolvedAt: null })
    expect(captured.audit).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: "super_admin",
      method: "NOTIFICATION_JOB_RETRY",
      path: `/api/admin/notification-jobs/${JOB}`,
    })
    expect(captured.audit?.payload).toMatchObject({ jobId: JOB, previousAttempts: 8 })
    const params = dialect.sqlToQuery(captured.lockWhere as any).params
    expect(params).toContain(JOB)
    expect(params).toContain(TENANT)
  })

  it("refuses to requeue a job that is not dead-lettered", async () => {
    const captured = harness({ ...DEAD, state: "pending" })

    const result = await retryNotificationJob({ id: JOB, tenantId: TENANT, actorId: ACTOR, actorRole: "super_admin" })

    expect(result).toEqual({ ok: false, reason: "not_dead_lettered" })
    expect(captured.updateSet).toBeUndefined()
    expect(captured.audit).toBeUndefined()
  })

  it("reports not-found when the tenant scope does not own the job", async () => {
    const captured = harness(null)

    const result = await retryNotificationJob({ id: JOB, tenantId: TENANT, actorId: ACTOR, actorRole: "super_admin" })

    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(captured.updateSet).toBeUndefined()
    expect(captured.audit).toBeUndefined()
  })

  it("resolves without sending and keeps the operator note as the honest reason", async () => {
    const captured = harness(DEAD, [{ id: JOB, state: "cancelled" }])

    const result = await resolveNotificationJob({
      id: JOB, tenantId: TENANT, actorId: ACTOR, actorRole: "super_admin", note: "recipient deleted",
    })

    expect(result).toEqual({ ok: true, id: JOB, state: "cancelled" })
    expect(captured.updateSet).toMatchObject({
      state: "cancelled", leaseToken: null, lastError: "operator_resolved: recipient deleted",
    })
    expect(captured.updateSet?.resolvedAt).toBeInstanceOf(Date)
    expect(captured.audit).toMatchObject({ method: "NOTIFICATION_JOB_RESOLVED" })
    expect(captured.audit?.payload).toMatchObject({ note: "recipient deleted", previousAttempts: 8 })
  })

  it("never resolves a non-dead row and never writes an audit for a refused action", async () => {
    const captured = harness({ ...DEAD, state: "provider_accepted" })

    const result = await resolveNotificationJob({ id: JOB, actorId: ACTOR, actorRole: "super_admin" })

    expect(result).toEqual({ ok: false, reason: "not_dead_lettered" })
    expect(captured.updateSet).toBeUndefined()
    expect(captured.audit).toBeUndefined()
  })
})
