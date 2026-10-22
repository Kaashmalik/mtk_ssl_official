import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PgDialect } from "drizzle-orm/pg-core"
import { notificationJobs } from "@mtk/database"

/**
 * ENH-06-04: durable notification jobs.
 *
 * A producer writes the job in the transaction that records the fact; the
 * bounded worker leases it with SKIP LOCKED, delivers outside the request,
 * and settles the row with a lease token. These tests pin that contract and
 * the account-level (no tenant) onboarding path.
 */

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  dispatch: vi.fn(),
  emailReady: vi.fn(() => true),
  emailFrom: vi.fn(() => "SSL <onboarding@ssl.test>"),
  buildEmail: vi.fn(() => ({ subject: "SSL: Welcome", text: "Welcome" })),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    insert: mocks.insert,
    update: mocks.update,
    select: mocks.select,
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/notification-dispatch", () => ({
  dispatchNotificationToMember: mocks.dispatch,
}))

vi.mock("@/lib/notification-email", () => ({
  notificationEmailReady: mocks.emailReady,
  notificationEmailFrom: mocks.emailFrom,
  buildNotificationEmail: mocks.buildEmail,
}))

import {
  ACCOUNT_WELCOME_EVENT_ID,
  enqueueAccountOnboardingJob,
  enqueueNotificationJob,
  processNotificationJobs,
} from "@/lib/notification-jobs"

const USER = "00000000-0000-4000-8000-0000000000f1"
const TENANT = "00000000-0000-4000-8000-0000000000f2"
const JOB = "00000000-0000-4000-8000-0000000000f3"

type EnqueueCapture = { values?: any; conflictTarget?: unknown[] }

function enqueueTx(result: unknown[] = [{ id: JOB }]) {
  const captured: EnqueueCapture = {}
  const tx = {
    insert: () => ({
      values: (values: unknown) => {
        captured.values = values
        return {
          onConflictDoNothing: (arg: { target: unknown[] }) => {
            captured.conflictTarget = arg.target
            return { returning: async () => result }
          },
        }
      },
    }),
  }
  return { tx: tx as any, captured }
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB,
    tenant_id: null,
    recipient_user_id: USER,
    event_id: ACCOUNT_WELCOME_EVENT_ID,
    channel: "email",
    type: "account_welcome",
    title: "Welcome to SSL",
    body: "Your account is ready.",
    data: { kind: "account_onboarding" },
    attempts: 1,
    ...overrides,
  }
}

/** Claim query is the second db.execute call; the first is the lease sweep. */
function claimed(...jobs: unknown[]) {
  mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce(jobs)
}

function settleChain(updates: any[], result: unknown[] = [{ id: JOB }]) {
  mocks.update.mockImplementation((() => ({
    set: (values: unknown) => {
      updates.push(values)
      return { where: () => ({ returning: async () => result }) }
    },
  })) as any)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.emailReady.mockReturnValue(true)
  mocks.emailFrom.mockReturnValue("SSL <onboarding@ssl.test>")
  mocks.buildEmail.mockReturnValue({ subject: "SSL: Welcome", text: "Welcome" })
  vi.stubEnv("NOTIFICATION_JOBS_READY", "true")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("ENH-06-04: enqueue is transactional and idempotent", () => {
  it("dedupes on event/recipient/channel", async () => {
    const { tx, captured } = enqueueTx()
    const enqueued = await enqueueNotificationJob(tx, {
      tenantId: null,
      recipientUserId: USER,
      eventId: "account.welcome",
      channel: "email",
      type: "account_welcome",
      title: "Welcome",
      body: "Hello",
    })

    expect(enqueued).toBe(true)
    expect(captured.values).toMatchObject({
      tenantId: null, recipientUserId: USER, eventId: "account.welcome", channel: "email",
    })
    expect(captured.conflictTarget).toEqual([
      notificationJobs.eventId, notificationJobs.recipientUserId, notificationJobs.channel,
    ])
  })

  it("reports a duplicate as not enqueued", async () => {
    const { tx } = enqueueTx([])
    await expect(enqueueNotificationJob(tx, {
      tenantId: TENANT,
      recipientUserId: USER,
      eventId: "match.started",
      channel: "push",
      type: "match_started",
      title: "Match started",
      body: "It is live",
    })).resolves.toBe(false)
  })

  it("refuses an invalid channel or over-long body before touching the database", async () => {
    const { tx } = enqueueTx()
    await expect(enqueueNotificationJob(tx, {
      tenantId: null, recipientUserId: USER, eventId: "x", channel: "sms" as any,
      type: "x", title: "x", body: "x",
    })).rejects.toThrow()
    await expect(enqueueNotificationJob(tx, {
      tenantId: null, recipientUserId: USER, eventId: "x", channel: "email",
      type: "x", title: "x", body: "x".repeat(501),
    })).rejects.toThrow()
  })

  it("queues the account welcome with NO tenant (membership not required)", async () => {
    const { tx, captured } = enqueueTx()
    await enqueueAccountOnboardingJob(tx, { userId: USER })
    expect(captured.values).toMatchObject({
      tenantId: null,
      recipientUserId: USER,
      eventId: ACCOUNT_WELCOME_EVENT_ID,
      channel: "email",
      type: "account_welcome",
    })
  })
})

describe("ENH-06-04: the worker is bounded and lease-fenced", () => {
  it("dead-letters exhausted pending jobs as well as expired leases", async () => {
    claimed()

    await processNotificationJobs(new Date("2026-10-21T00:00:00Z"))

    const sweep = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0] as any)
    expect(sweep.sql).toContain("state IN ('leased', 'pending')")
    expect(sweep.sql).toContain("attempts_exhausted")
    expect(sweep.sql).toContain("next_attempt_at IS NULL")
  })

  it("claims nothing and touches no row while the flag is off", async () => {
    vi.stubEnv("NOTIFICATION_JOBS_READY", "false")
    const summary = await processNotificationJobs()
    expect(summary).toMatchObject({ enabled: false, claimed: 0 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it("delivers an account-level email and records provider acceptance", async () => {
    claimed(job())
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ email: "fan@test", isActive: true }] }) }),
    })
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })))
    const updates: any[] = []
    settleChain(updates)
    vi.stubEnv("RESEND_API_KEY", "re_test")

    const summary = await processNotificationJobs(new Date("2026-10-21T00:00:00Z"))

    expect(summary).toMatchObject({ enabled: true, claimed: 1, accepted: 1 })
    expect(updates[0]).toMatchObject({ state: "provider_accepted", leaseToken: null, lastError: null })
  })

  it("leaves the job pending after a transport failure", async () => {
    claimed(job({ attempts: 2 }))
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ email: "fan@test", isActive: true }] }) }),
    })
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const updates: any[] = []
    settleChain(updates)
    vi.stubEnv("RESEND_API_KEY", "re_test")

    const summary = await processNotificationJobs(new Date("2026-10-21T00:00:00Z"))

    expect(summary).toMatchObject({ retrying: 1, accepted: 0 })
    expect(updates[0]).toMatchObject({ state: "pending", lastError: "network_unknown" })
    expect(updates[0].nextAttemptAt.getTime()).toBeGreaterThan(new Date("2026-10-21T00:00:00Z").getTime())
  })

  it("dead-letters the final attempt instead of retrying forever", async () => {
    claimed(job({ attempts: 8 }))
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ email: "fan@test", isActive: true }] }) }),
    })
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const updates: any[] = []
    settleChain(updates)
    vi.stubEnv("RESEND_API_KEY", "re_test")

    const summary = await processNotificationJobs()

    expect(summary).toMatchObject({ deadLettered: 1, retrying: 0 })
    expect(updates[0]).toMatchObject({ state: "dead_lettered", lastError: "network_unknown" })
  })

  it("cancels an unwired channel honestly instead of sending", async () => {
    claimed(job())
    mocks.emailReady.mockReturnValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const updates: any[] = []
    settleChain(updates)

    const summary = await processNotificationJobs()

    expect(summary).toMatchObject({ cancelled: 1 })
    expect(updates[0]).toMatchObject({ state: "cancelled", lastError: "channel_unwired" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not count a job whose lease was already re-claimed", async () => {
    claimed(job())
    mocks.emailReady.mockReturnValue(false)
    const updates: any[] = []
    settleChain(updates, [])

    const summary = await processNotificationJobs()
    expect(summary).toMatchObject({ cancelled: 0, accepted: 0, claimed: 1 })
  })

  it("routes a league job through the same dispatch gate", async () => {
    claimed(job({ tenant_id: TENANT, channel: "push", type: "match_started" }))
    mocks.dispatch.mockResolvedValue({ written: true, reason: "ok", sendState: "provider_accepted" })
    const updates: any[] = []
    settleChain(updates)

    const summary = await processNotificationJobs()

    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, memberId: USER, channel: "push", type: "match_started",
    }))
    expect(summary).toMatchObject({ accepted: 1 })
  })
})

describe("ENH-06-04: worker source invariants", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../lib/notification-jobs.ts"),
    "utf8",
  )
  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations/20261021130000_notification_jobs.sql"),
    "utf8",
  )

  it("claims due rows with SKIP LOCKED and settles only the matching lease", () => {
    expect(source).toContain("FOR UPDATE SKIP LOCKED")
    expect(source).toContain("eq(notificationJobs.leaseToken, lease)")
    expect(source).toContain("eq(notificationJobs.state, \"leased\")")
  })

  it("keeps provider acceptance distinct from delivery and the job dedup key in SQL", () => {
    expect(migration).toContain("notification_jobs_event_recipient_channel_key")
    expect(migration).toContain("provider_accepted")
    expect(migration).toContain("tenant_id uuid REFERENCES public.tenants(id)")
  })
})
