import { randomUUID } from "node:crypto"
import { db, notificationJobs, users } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  NOTIFICATION_JOB_MAX_ATTEMPTS,
  classifyNotificationJobFailure,
  notificationJobRetryDelayMs,
  type NotificationJobDelivery,
} from "@mtk/database/lib/notification-job-policy"
import { dispatchNotificationToMember } from "./notification-dispatch"
import { buildNotificationEmail, notificationEmailFrom, notificationEmailReady } from "./notification-email"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * ENH-06-04: durable notification delivery.
 *
 * The producer only writes a row INSIDE the transaction that records the fact
 * that owes the notice. Provider HTTP runs later in the bounded worker/cron
 * (never in a serverless request lifetime, where a mid-flight termination
 * would lose the work without a record). Rows are claimed with a
 * `FOR UPDATE SKIP LOCKED` lease; every settlement is fenced on that lease so
 * two replicas cannot both settle the same job.
 */
export const notificationJobsEnabled = () => process.env.NOTIFICATION_JOBS_READY === "true"

/** One bounded claim per run; the cron can run more often than the batch size. */
export const NOTIFICATION_JOB_BATCH_LIMIT = 20

const enqueueInputSchema = z.object({
  /** null = account-level notice that must not require league membership. */
  tenantId: z.string().uuid().nullable(),
  recipientUserId: z.string().uuid(),
  eventId: z.string().min(1).max(160),
  channel: z.enum(["in_app", "email", "push"]),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  body: z.string().max(500),
  data: z.record(z.unknown()).default({}),
}).strict()

export type EnqueueNotificationJobInput = z.input<typeof enqueueInputSchema>

/**
 * Idempotent producer: `unique(event_id, recipient_user_id, channel)` makes a
 * webhook redelivery or a replayed request a no-op instead of a second send.
 * Must be called with a transaction when the job represents a durable fact.
 */
export async function enqueueNotificationJob(
  tx: Tx,
  input: EnqueueNotificationJobInput,
): Promise<boolean> {
  const parsed = enqueueInputSchema.parse(input)
  const [row] = await tx.insert(notificationJobs)
    .values({
      tenantId: parsed.tenantId,
      recipientUserId: parsed.recipientUserId,
      eventId: parsed.eventId,
      channel: parsed.channel,
      type: parsed.type,
      title: parsed.title,
      body: parsed.body,
      data: parsed.data,
    })
    .onConflictDoNothing({
      target: [notificationJobs.eventId, notificationJobs.recipientUserId, notificationJobs.channel],
    })
    .returning({ id: notificationJobs.id })
  return Boolean(row)
}

export const ACCOUNT_WELCOME_EVENT_ID = "account.welcome"

/**
 * Account-level onboarding delivery. It deliberately carries NO tenant: a
 * brand-new account often has no league membership yet, and that must not
 * prevent the transactional welcome from being owed. The worker re-reads the
 * active account's verified email at delivery time.
 */
export async function enqueueAccountOnboardingJob(
  tx: Tx,
  input: { userId: string },
): Promise<boolean> {
  return enqueueNotificationJob(tx, {
    tenantId: null,
    recipientUserId: input.userId,
    eventId: ACCOUNT_WELCOME_EVENT_ID,
    channel: "email",
    type: "account_welcome",
    title: "Welcome to SSL",
    body: "Your account is ready. Sign in to follow leagues, join as a fan, or set up your own league.",
    data: { kind: "account_onboarding" },
  })
}

type ClaimedJob = {
  id: string
  tenant_id: string | null
  recipient_user_id: string
  event_id: string
  channel: string
  type: string
  title: string
  body: string
  data: unknown
  attempts: number
}

export type NotificationJobRunSummary = {
  enabled: boolean
  claimed: number
  accepted: number
  cancelled: number
  retrying: number
  deadLettered: number
}

const EMPTY_RUN: NotificationJobRunSummary = {
  enabled: false, claimed: 0, accepted: 0, cancelled: 0, retrying: 0, deadLettered: 0,
}

function matchIdFromData(data: unknown): string | undefined {
  const raw = (data as { matchId?: unknown } | null | undefined)?.matchId
  if (typeof raw !== "string") return undefined
  const parsed = z.string().uuid().safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/**
 * A league-scoped job goes through the SAME consent/dedup/policy gate as a
 * direct dispatch. Refusals that name a durable reason (consent, no recipient,
 * unwired channel, duplicate) are terminal; quiet hours is a timing refusal,
 * so the job is retried on the backoff ladder.
 */
async function deliverTenantJob(job: ClaimedJob): Promise<NotificationJobDelivery> {
  const matchId = matchIdFromData(job.data)
  const result = await dispatchNotificationToMember({
    tenantId: job.tenant_id,
    memberId: job.recipient_user_id,
    type: job.type,
    title: job.title,
    body: job.body,
    dedupKey: `notification-job:${job.event_id}`.slice(0, 120),
    channel: job.channel,
    ...(matchId ? { matchId } : {}),
  })
  if (result.written) {
    if (result.sendState === "provider_refused") {
      // The ledger row keeps the provider's own refusal reason; retrying would
      // be suppressed by that row's dedup key, so do not pretend otherwise.
      return { outcome: "cancelled", reason: "provider_refused" }
    }
    return { outcome: "accepted" }
  }
  if (result.reason === "quiet_hours") return { outcome: "retry", reason: "quiet_hours" }
  return { outcome: "cancelled", reason: result.reason }
}

/**
 * Account-level mail has no tenant, so it cannot use the league dispatch
 * gate. It still uses the shared plain-text template and the same
 * `NOTIFICATION_EMAIL_READY` wiring: an unconfigured channel is recorded as
 * cancelled, never silently sent or claimed as delivered.
 */
async function deliverAccountJob(job: ClaimedJob): Promise<NotificationJobDelivery> {
  if (job.channel !== "email") {
    return { outcome: "cancelled", reason: "account_channel_unsupported" }
  }
  if (!notificationEmailReady()) return { outcome: "cancelled", reason: "channel_unwired" }

  const [account] = await db
    .select({ email: users.email, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, job.recipient_user_id))
    .limit(1)
  if (!account?.isActive || !account.email) {
    return { outcome: "cancelled", reason: "no_recipient" }
  }

  const mail = buildNotificationEmail({
    leagueName: "SSL",
    title: job.title,
    body: job.body,
    brand: null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
  })

  let response: Response
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
        "Content-Type": "application/json",
        // Stable per job row: a retried attempt cannot duplicate the welcome.
        "Idempotency-Key": `notification-job/${job.id}`,
      },
      body: JSON.stringify({
        from: notificationEmailFrom(),
        to: account.email,
        subject: mail.subject,
        text: mail.text,
      }),
    })
  } catch {
    return classifyNotificationJobFailure({
      attempts: job.attempts,
      reason: "network_unknown",
      permanent: false,
    })
  }
  if (response.ok) return { outcome: "accepted" }
  const permanent = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)
  return classifyNotificationJobFailure({
    attempts: job.attempts,
    reason: `provider_http_${response.status}`,
    permanent,
  })
}

async function deliverNotificationJob(job: ClaimedJob): Promise<NotificationJobDelivery> {
  if (!job.tenant_id) return deliverAccountJob(job)
  return deliverTenantJob(job)
}

/**
 * Bounded, idempotent worker pass. Returns counts only; every outcome is also
 * written back to the row (`state`, `attempts`, `last_error`, `resolved_at`).
 */
export async function processNotificationJobs(now = new Date()): Promise<NotificationJobRunSummary> {
  if (!notificationJobsEnabled()) return { ...EMPTY_RUN }

  // A worker that died on its final attempt must become terminal instead of
  // staying leased forever.
  await db.execute(sql`UPDATE public.notification_jobs
    SET state = 'dead_lettered', lease_token = NULL, resolved_at = now(),
        last_error = COALESCE(last_error, 'lease_expired')
    WHERE state = 'leased' AND attempts >= ${NOTIFICATION_JOB_MAX_ATTEMPTS}
      AND next_attempt_at <= now()`)

  const lease = randomUUID()
  const claimed = await db.execute(sql`WITH due AS (
    SELECT j.id FROM public.notification_jobs j
    WHERE j.state IN ('pending','leased')
      AND j.attempts < ${NOTIFICATION_JOB_MAX_ATTEMPTS}
      AND j.next_attempt_at <= now()
    ORDER BY j.next_attempt_at, j.id
    LIMIT ${NOTIFICATION_JOB_BATCH_LIMIT}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_jobs j
  SET state = 'leased', lease_token = ${lease}::uuid,
      attempts = j.attempts + 1,
      next_attempt_at = now() + interval '2 minutes'
  FROM due WHERE j.id = due.id
  RETURNING j.*`) as unknown as ClaimedJob[]

  const summary: NotificationJobRunSummary = {
    enabled: true, claimed: claimed.length, accepted: 0, cancelled: 0, retrying: 0, deadLettered: 0,
  }

  for (const job of claimed) {
    let delivery: NotificationJobDelivery
    try {
      delivery = await deliverNotificationJob(job)
    } catch {
      delivery = classifyNotificationJobFailure({
        attempts: job.attempts,
        reason: "worker_error",
        permanent: false,
      })
    }

    const state = delivery.outcome === "accepted"
      ? "provider_accepted"
      : delivery.outcome === "cancelled"
        ? "cancelled"
        : delivery.outcome === "dead"
          ? "dead_lettered"
          : "pending"
    const resolved = delivery.outcome !== "retry"
    const lastError = "reason" in delivery ? delivery.reason : null

    const [settled] = await db.update(notificationJobs)
      .set({
        state,
        leaseToken: null,
        lastError,
        resolvedAt: resolved ? now : null,
        nextAttemptAt: new Date(now.getTime() + notificationJobRetryDelayMs(job.attempts)),
      })
      // Lease fencing: a stale worker whose lease was re-claimed cannot settle
      // the newer attempt.
      .where(and(
        eq(notificationJobs.id, job.id),
        eq(notificationJobs.leaseToken, lease),
        eq(notificationJobs.state, "leased"),
      ))
      .returning({ id: notificationJobs.id })
    if (!settled) continue

    switch (delivery.outcome) {
      case "accepted": summary.accepted += 1; break
      case "cancelled": summary.cancelled += 1; break
      case "dead": summary.deadLettered += 1; break
      default: summary.retrying += 1
    }
  }

  return summary
}
