import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { db, auditLogs, leagueApplications, leagueApplicationReplies } from "@mtk/database"
import {
  getMyLeagueApplication,
  replyLeagueApplication,
  saveLeagueApplication,
  submitLeagueApplication,
  withdrawLeagueApplication,
} from "@/app/actions/league-applications"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// Real schema tables and the real policy pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

const dialect = new PgDialect()
const USER = "da7c0ab5-0810-482a-a92c-886a87754b20"
const APP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    applicantId: USER,
    proposedName: "My League",
    proposedSlug: "my-league",
    desiredPlan: "free",
    state: "draft",
    version: 0,
    reviewReason: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    provisionedTenantId: null,
    createdAt: new Date("2026-10-17T08:00:00.000Z"),
    updatedAt: new Date("2026-10-17T08:00:00.000Z"),
    ...overrides,
  }
}

/**
 * Queues outer (non-transactional) select results in call order. Both chain
 * shapes are covered: `.where(...).limit(...)` (account lookup) and
 * `.where(...).orderBy(...).limit(...)` (latest application read).
 */
function queueOuterSelects(rows: unknown[][]) {
  const select = vi.fn()
  rows.forEach((r) => select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () => r,
        orderBy: () => ({ limit: async () => r }),
      }),
    }),
  }))
  ;(db as any).select = select
  return select
}

interface TxOptions {
  /** Select-result queues in call order (one entry per in-transaction select). */
  selects?: unknown[][]
  /** Returning rows of the principal insert. */
  insertResult?: unknown[]
  /** Returning rows of the update. */
  updateResult?: unknown[]
  insertError?: unknown
}

/** Builds the transaction mock: row lock, in-transaction guards, write chains. */
function txMock({
  selects = [],
  insertResult = [],
  updateResult = [],
  insertError = null,
}: TxOptions = {}) {
  const locks: unknown[] = []
  const selectConds: unknown[] = []
  const inserts: Array<{ table: unknown; values: any }> = []
  const updates: Array<{ set: any; where: unknown }> = []
  const queues = [...selects]

  const execute = vi.fn(async (statement: unknown) => {
    locks.push(statement)
  })

  const select = vi.fn(() => ({
    from: () => ({
      where: (cond: unknown) => {
        selectConds.push(cond)
        const rows = queues.shift() ?? []
        return {
          limit: async () => rows,
          for: () => ({ limit: async () => rows }),
        }
      },
    }),
  }))

  const insert = vi.fn((table: unknown) => ({
    values: (values: any) => {
      inserts.push({ table, values })
      return {
        returning: async () => {
          if (insertError) throw insertError
          return insertResult
        },
        onConflictDoNothing: async () => {},
      }
    },
  }))

  const update = vi.fn(() => ({
    set: (set: any) => ({
      where: (where: unknown) => {
        updates.push({ set, where })
        return { returning: async () => updateResult }
      },
    }),
  }))

  ;(db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ execute, select, insert, update }))
  return { execute, select, insert, update, locks, selectConds, inserts, updates }
}

function auditFor(tx: ReturnType<typeof txMock>, method: string) {
  const entry = tx.inserts.find((item) => item.table === auditLogs && item.values?.method === method)
  return entry?.values
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-1" })
})

describe("saveLeagueApplication", () => {
  it("creates a draft under the applicant row lock and audits the write", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ insertResult: [appRow()] })

    const response = await saveLeagueApplication({
      name: "My League",
      slug: "my-league",
      desiredPlan: "starter",
      expectedVersion: null,
    })

    expect(response.success).toBe(true)
    expect(response.application.state).toBe("draft")
    expect(response.application.version).toBe(0)

    // The same serialization point createTenant uses: the account row lock.
    expect(tx.execute).toHaveBeenCalledTimes(1)
    const lock = dialect.sqlToQuery(tx.locks[0] as never)
    expect(lock.sql).toContain("FOR UPDATE")
    expect(lock.params).toEqual([USER])

    // The active-slot lookup speaks the full active vocabulary.
    const activeCond = dialect.sqlToQuery(tx.selectConds[2] as never)
    expect(activeCond.params).toEqual([USER, "draft", "submitted", "needs_information"])

    const inserted = tx.inserts.find((item) => item.table === leagueApplications)
    expect(inserted?.values).toMatchObject({
      applicantId: USER,
      proposedName: "My League",
      proposedSlug: "my-league",
      desiredPlan: "starter",
      state: "draft",
      version: 0,
    })

    const audit = auditFor(tx, "LEAGUE_APPLICATION_SAVE")
    expect(audit).toMatchObject({ actorId: USER, actorRole: "fan" })
    expect(audit?.payload).toMatchObject({ applicationId: APP_ID })
  })

  it("derives the slug from the name when the input leaves it blank", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ insertResult: [appRow()] })

    await saveLeagueApplication({ name: "My League", slug: "", desiredPlan: "free", expectedVersion: null })

    const inserted = tx.inserts.find((item) => item.table === leagueApplications)
    expect(inserted?.values.proposedSlug).toBe("my-league")
  })

  it("updates a draft with a version CAS and a server-side version bump", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({
      selects: [[], [], [appRow({ state: "draft", version: 3 })]],
      updateResult: [appRow({ state: "draft", version: 4, proposedName: "Renamed" })],
    })

    const response = await saveLeagueApplication({
      name: "Renamed",
      slug: "my-league",
      desiredPlan: "free",
      expectedVersion: 3,
    })

    expect(response.application.version).toBe(4)
    const update = tx.updates[0]
    expect(update.set.proposedName).toBe("Renamed")
    const versionSet = dialect.sqlToQuery(update.set.version as never)
    expect(versionSet.sql).toContain("+ 1")
    const where = dialect.sqlToQuery(update.where as never)
    expect(where.params).toContain(APP_ID)
    expect(where.params).toContain(3)
    expect(where.params).toEqual(expect.arrayContaining(["draft", "needs_information"]))
    expect(auditFor(tx, "LEAGUE_APPLICATION_SAVE")).toBeDefined()
  })

  it("refuses a stale edit without writing", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[], [], [appRow({ state: "draft", version: 3 })]] })

    await expect(saveLeagueApplication({
      name: "Mine", slug: "mine", desiredPlan: "free", expectedVersion: 2,
    })).rejects.toThrow(/changed in another window/)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("refuses to edit an application that is already submitted", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[], [], [appRow({ state: "submitted", version: 1 })]] })

    await expect(saveLeagueApplication({
      name: "Mine", slug: "mine", desiredPlan: "free", expectedVersion: 1,
    })).rejects.toThrow(/can no longer be edited/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it("refuses to create a second active application (two-tab race)", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[], [], [appRow()]] })

    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow(/changed in another window/)
    expect(tx.inserts.some((item) => item.table === leagueApplications)).toBe(false)
  })

  it("refuses an applicant who already owns a league", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[{ id: "already-owned" }]] })

    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow(/already have a league/)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("maps a taken slug to the friendly duplicate error before any write", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[], [{ id: "taken" }]] })

    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow(/already taken/)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("stops unauthenticated callers before any read", async () => {
    mocks.auth.mockResolvedValue({})
    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow("Unauthorized")
    expect(db.select).not.toHaveBeenCalled()
  })

  it("refuses a signed-in account with no database row or an inactive one", async () => {
    queueOuterSelects([[]])
    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow(/still being set up/)

    queueOuterSelects([[{ id: USER, isActive: false, role: "fan" }]])
    await expect(saveLeagueApplication({
      name: "My League", slug: "my-league", desiredPlan: "free", expectedVersion: null,
    })).rejects.toThrow("Your account is inactive")
  })
})

describe("submitLeagueApplication", () => {
  it("submits a draft: version CAS, clears the review note and stamps submittedAt", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({
      selects: [[appRow({ state: "draft", version: 0 })]],
      updateResult: [appRow({ state: "submitted", version: 1, submittedAt: new Date("2026-10-17T09:00:00.000Z") })],
    })

    const response = await submitLeagueApplication({ expectedVersion: 0 })

    expect(response.application.state).toBe("submitted")
    const update = tx.updates[0]
    expect(update.set.state).toBe("submitted")
    expect(update.set.reviewReason).toBeNull()
    expect(update.set.submittedAt).toBeInstanceOf(Date)
    const where = dialect.sqlToQuery(update.where as never)
    expect(where.params).toContain(APP_ID)
    expect(where.params).toContain(0)
    expect(auditFor(tx, "LEAGUE_APPLICATION_SUBMIT")).toBeDefined()
  })

  it("resubmits after a request for information", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({
      selects: [[appRow({ state: "needs_information", version: 5, reviewReason: "Please clarify the venue." })]],
      updateResult: [appRow({ state: "submitted", version: 6 })],
    })

    const response = await submitLeagueApplication({ expectedVersion: 5 })

    expect(response.application.state).toBe("submitted")
    expect(tx.updates[0].set.reviewReason).toBeNull()
  })

  it("refuses a stale submit without writing", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[appRow({ state: "draft", version: 2 })]] })

    await expect(submitLeagueApplication({ expectedVersion: 1 }))
      .rejects.toThrow(/changed in another window/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it("refuses when nothing is active to submit", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock()

    await expect(submitLeagueApplication({ expectedVersion: 0 }))
      .rejects.toThrow(/do not have an application to submit/)
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe("withdrawLeagueApplication", () => {
  it("withdraws a submitted application and audits it", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({
      selects: [[appRow({ state: "submitted", version: 4 })]],
      updateResult: [appRow({ state: "withdrawn", version: 5 })],
    })

    const response = await withdrawLeagueApplication({ expectedVersion: 4 })

    expect(response.application.state).toBe("withdrawn")
    expect(tx.updates[0].set.state).toBe("withdrawn")
    expect(auditFor(tx, "LEAGUE_APPLICATION_WITHDRAW")).toBeDefined()
  })

  it("refuses when nothing is active to withdraw", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock()

    await expect(withdrawLeagueApplication({ expectedVersion: 0 }))
      .rejects.toThrow(/do not have an application to withdraw/)
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe("getMyLeagueApplication", () => {
  it("returns the newest application with JSON-safe timestamps", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true }],
      [appRow({ state: "submitted", submittedAt: new Date("2026-10-17T09:00:00.000Z") })],
      [],
    ])

    const response = await getMyLeagueApplication()

    expect(response.application?.state).toBe("submitted")
    expect(response.application?.submittedAt).toBe("2026-10-17T09:00:00.000Z")
    expect(response.application?.reviewReason).toBeNull()
    // ENH-02-02: no application means no thread, not an error.
    expect(response.replies).toEqual([])
  })

  it("reads the persisted reply thread with the application, oldest first (ENH-02-02)", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true }],
      [appRow({ state: "needs_information", version: 2 })],
      [
        { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3401", applicationId: APP_ID, authorId: USER, authorSide: "applicant", body: "first answer", createdAt: new Date("2026-10-18T09:00:00.000Z") },
        { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3402", applicationId: APP_ID, authorId: USER, authorSide: "applicant", body: "second answer", createdAt: new Date("2026-10-18T10:00:00.000Z") },
      ],
    ])

    const response = await getMyLeagueApplication()

    expect(response.replies).toHaveLength(2)
    expect(response.replies?.[0]).toMatchObject({ body: "first answer", authorSide: "applicant" })
    expect(response.replies?.[0]?.createdAt).toBe("2026-10-18T09:00:00.000Z")
   })

  it("returns null for an unauthenticated caller without reading", async () => {
    mocks.auth.mockResolvedValue({})
    expect(await getMyLeagueApplication()).toEqual({ application: null, replies: [] })
    expect(db.select).not.toHaveBeenCalled()
  })

  it("returns null for a missing or inactive account", async () => {
    queueOuterSelects([[]])
    expect(await getMyLeagueApplication()).toEqual({ application: null, replies: [] })

    queueOuterSelects([[{ id: USER, isActive: false }]])
    expect(await getMyLeagueApplication()).toEqual({ application: null, replies: [] })
  })
})

const REPLY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3401"

function replyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPLY_ID,
    applicationId: APP_ID,
    authorId: USER,
    authorSide: "applicant",
    body: "Sent the club list.",
    createdAt: new Date("2026-10-18T09:00:00.000Z"),
    ...overrides,
  }
}

describe("replyLeagueApplication (ENH-02-02)", () => {
  it("persists the applicant reply under the account row lock and audits it", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({
      selects: [[appRow({ state: "needs_information", version: 2 })]],
      insertResult: [replyRow()],
    })

    const response = await replyLeagueApplication({ applicationId: APP_ID, body: "  Sent the club list.  " })

    // The same serialization point as every other applicant write.
    const lock = dialect.sqlToQuery(tx.locks[0] as never)
    expect(lock.sql).toContain("FOR UPDATE")
    expect(lock.params).toEqual([USER])

    // Ownership and identity are one guard predicate, then row lock.
    const guard = dialect.sqlToQuery(tx.selectConds[0] as never)
    expect(guard.params).toEqual([APP_ID, USER])

    const inserted = tx.inserts.find((item) => item.table === leagueApplicationReplies)
    expect(inserted?.values).toMatchObject({
      applicationId: APP_ID,
      authorId: USER,
      authorSide: "applicant",
      body: "Sent the club list.",
    })

    // Replies are additive records: no state move, no version bump.
    expect(tx.updates).toHaveLength(0)
    expect(auditFor(tx, "LEAGUE_APPLICATION_REPLY")).toMatchObject({ actorId: USER, actorRole: "fan" })
    expect(response.reply).toMatchObject({ id: REPLY_ID, authorSide: "applicant", body: "Sent the club list." })
    expect((response.reply as { createdAt: string }).createdAt).toBe("2026-10-18T09:00:00.000Z")
  })

  it("refuses to reply until a reviewer actually requested information", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[appRow({ state: "submitted", version: 1 })]] })

    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "hello" })).rejects.toThrow(/requested information/)
    expect(tx.inserts.find((item) => item.table === leagueApplicationReplies)).toBeUndefined()
  })

  it("keeps a decided application as locked history", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[appRow({ state: "rejected", version: 4 })]] })

    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "hello" })).rejects.toThrow(/read only/)
    expect(tx.inserts.find((item) => item.table === leagueApplicationReplies)).toBeUndefined()
  })

  it("refuses a reply on an application the account does not own", async () => {
    queueOuterSelects([[{ id: USER, isActive: true, role: "fan" }]])
    const tx = txMock({ selects: [[]] })

    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "hello" })).rejects.toThrow(/do not have an application/)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("refuses blank or oversized bodies before any write begins", async () => {
    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "   " })).rejects.toThrow(/Write a message/)
    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "x".repeat(2001) })).rejects.toThrow(/within 2000/)
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it("refuses an inactive or missing account", async () => {
    queueOuterSelects([[{ id: USER, isActive: false }]])
    await expect(replyLeagueApplication({ applicationId: APP_ID, body: "hello" })).rejects.toThrow()
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

