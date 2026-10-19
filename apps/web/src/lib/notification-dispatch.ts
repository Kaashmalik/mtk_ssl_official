import { db, notifications, notificationPreferences, fanFollows, users, tenants } from "@mtk/database"
import { and, eq, gte, sql, desc } from "drizzle-orm"
import { z } from "zod"
import { memberDeliveryDecision, MINUTE_OF_DAY_MAX } from "@mtk/database/lib/notification-policy"
import { isValidTimeZone } from "./time-policy"
import { getTenantBranding } from "./tenant"
import { brandPresentation, type BrandPresentation } from "./brand-presentation"
import { buildNotificationEmail, notificationEmailFrom, notificationEmailReady, type NotificationEmail } from "./notification-email"

/**
 * FAN-02 notification dispatch (locked writer).
 *
 * The single path notifications flow through: consent gate first, dedup next,
 * then the insert. A row is only written when the shared policy explicitly
 * allows the channel NOW — nothing is written "for later delivery", because a
 * row that promises a send no one performs would be a fabricated delivery.
 *
 * Channels: `in_app` always. Email (B161) only when the member consented
 * (notification_preferences.email_enabled) AND the deployment wired the
 * channel (NOTIFICATION_EMAIL_READY + RESEND_API_KEY) — consent without
 * wiring reads channel_unwired and writes nothing. The provider attempt
 * happens AFTER the consent transaction commits (provider HTTP never holds
 * the row lock) and its outcome is recorded honestly on the row:
 * `provider_accepted` means the provider took the message, never that a
 * human read it. Push/sms remain honestly unwired.
 */

/** Duplicate fan-outs for the same fact inside this window are suppressed. */
export const DEDUP_WINDOW_HOURS = 24

/** Fan-out to followers is bounded; the honest boundary is recorded in copy. */
export const FOLLOWER_FANOUT_LIMIT = 200

const dispatchInputSchema = z.object({
  tenantId: z.string().uuid(),
  memberId: z.string().uuid(),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  body: z.string().max(500),
  dedupKey: z.string().min(8).max(120),
  channel: z.enum(["in_app", "email"]).default("in_app"),
})

export type DispatchResult = {
  written: boolean
  /** Always present: `ok` on a write, otherwise the honest refusal reason. */
  reason: "ok" | "consent_off" | "quiet_hours" | "channel_unwired" | "deduplicated" | "no_recipient"
  /** EMAIL only: the honest, post-commit provider outcome (never "delivered"). */
  sendState?: "provider_accepted" | "provider_refused"
}

type EmailDeliveryContext = {
  rowId: string
  to: string
  leagueName: string
  brand: BrandPresentation | null
  email: NotificationEmail
}

/**
 * One notification to one member of one league, through the consent/dedup
 * gates. The preferences row is locked FOR UPDATE so a concurrent settings
 * save cannot race the decision.
 */
export async function dispatchNotificationToMember(input: unknown): Promise<DispatchResult> {
  const parsed = dispatchInputSchema.parse(input)
  const now = new Date()
  const quietCutoff = new Date(now.getTime() - DEDUP_WINDOW_HOURS * 3_600_000)

  const result = await db.transaction(async (tx): Promise<
    DispatchResult & { email?: EmailDeliveryContext }
  > => {
    const [prefs] = await tx
      .select({
        inAppEnabled: notificationPreferences.inAppEnabled,
        emailEnabled: notificationPreferences.emailEnabled,
        quietStartMinute: notificationPreferences.quietStartMinute,
        quietEndMinute: notificationPreferences.quietEndMinute,
        timeZone: notificationPreferences.timeZone,
      })
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.tenantId, parsed.tenantId),
        eq(notificationPreferences.userId, parsed.memberId),
      ))
      .for("update")
      .limit(1)

    const decision = memberDeliveryDecision({
      channel: parsed.channel,
      prefs: prefs ?? null,
      now,
      wiring: parsed.channel === "email" ? { email: notificationEmailReady() } : undefined,
    })
    if (!decision.allowed) return { written: false, reason: decision.reason }

    const [duplicate] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, parsed.tenantId),
        eq(notifications.userId, parsed.memberId),
        eq(notifications.type, parsed.type),
        eq(notifications.channel, parsed.channel),
        gte(notifications.createdAt, quietCutoff),
        sql`${notifications.data} ->> 'dedupKey' = ${parsed.dedupKey}`,
      ))
      .limit(1)
    if (duplicate) return { written: false, reason: "deduplicated" }

    if (parsed.channel === "in_app") {
      await tx.insert(notifications).values({
        tenantId: parsed.tenantId,
        userId: parsed.memberId,
        type: parsed.type,
        channel: "in_app",
        title: parsed.title,
        body: parsed.body,
        data: { dedupKey: parsed.dedupKey },
      })
      return { written: true, reason: "ok" }
    }

    // EMAIL: an active account with a real address is required; consent was
    // already proven above by the same policy that gates the channel.
    const [account] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, parsed.memberId), eq(users.isActive, true)))
      .limit(1)
    if (!account?.email) return { written: false, reason: "no_recipient" }

    const [row] = await tx.insert(notifications).values({
      tenantId: parsed.tenantId,
      userId: parsed.memberId,
      type: parsed.type,
      channel: "email",
      title: parsed.title,
      body: parsed.body,
      data: { dedupKey: parsed.dedupKey, deliveryState: "queued" },
    }).returning({ id: notifications.id })

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, parsed.tenantId))
      .limit(1)
    const brand = brandPresentation(await getTenantBranding(parsed.tenantId))
    const email = buildNotificationEmail({
      leagueName: tenant?.name ?? "",
      title: parsed.title,
      body: parsed.body,
      brand,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    })

    return {
      written: true,
      reason: "ok",
      email: { rowId: row.id, to: account.email, leagueName: tenant?.name ?? "", brand, email },
    }
  })

  // Provider HTTP happens strictly AFTER the consent transaction has committed.
  if (result.written && result.email) {
    const { email: delivery } = result
    try {
      const apiKey = process.env.RESEND_API_KEY?.trim()
      if (!apiKey) {
        await db.update(notifications)
          .set({ data: { dedupKey: parsed.dedupKey, deliveryState: "provider_refused", deliveryError: "provider_unconfigured" } })
          .where(eq(notifications.id, delivery.rowId))
        return { written: true, reason: "ok", sendState: "provider_refused" }
      }
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `notification-email/${delivery.rowId}`,
        },
        body: JSON.stringify({
          from: notificationEmailFrom(),
          to: delivery.to,
          subject: delivery.email.subject,
          text: delivery.email.text,
          tags: [{ name: "notification_id", value: delivery.rowId }],
        }),
      })
      const sendState: DispatchResult["sendState"] = response.ok ? "provider_accepted" : "provider_refused"
      await db.update(notifications)
        .set({ data: { dedupKey: parsed.dedupKey, deliveryState: sendState, ...(response.ok ? {} : { deliveryError: `provider_http_${response.status}` }) } })
        .where(eq(notifications.id, delivery.rowId))
      return { written: true, reason: "ok", sendState }
    } catch {
      await db.update(notifications)
        .set({ data: { dedupKey: parsed.dedupKey, deliveryState: "provider_refused", deliveryError: "network_unknown" } })
        .where(eq(notifications.id, delivery.rowId))
      return { written: true, reason: "ok", sendState: "provider_refused" }
    }
  }

  return { written: result.written, reason: result.reason }
}

/**
 * Fan a notification out to (a bounded number of) followers of a tournament in
 * one league. Each member passes the same consent/dedup gate individually; a
 * failure for one member never aborts the others.
 */
export async function dispatchNotificationToTournamentFollowers(input: {
  tenantId: string
  tournamentId: string
  type: string
  title: string
  body: string
  dedupKey: string
}): Promise<{ fanout: number; written: number }> {
  z.string().uuid().parse(input.tenantId)
  z.string().uuid().parse(input.tournamentId)
  const followers = await db
    .select({ userId: fanFollows.userId })
    .from(fanFollows)
    .innerJoin(users, and(eq(users.id, fanFollows.userId), eq(users.isActive, true)))
    .where(and(
      eq(fanFollows.tenantId, input.tenantId),
      eq(fanFollows.followableType, "tournament"),
      eq(fanFollows.followableId, input.tournamentId),
    ))
    .orderBy(desc(fanFollows.createdAt))
    .limit(FOLLOWER_FANOUT_LIMIT)

  let written = 0
  for (const follower of followers) {
    try {
      const result = await dispatchNotificationToMember({
        tenantId: input.tenantId,
        memberId: follower.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        dedupKey: input.dedupKey,
      })
      if (result.written) written += 1
    } catch {
      // One member's delivery problem never aborts the fan-out.
    }
  }
  return { fanout: followers.length, written }
}

const notificationPreferencesInputSchema = z.object({
  inAppEnabled: z.boolean(),
  /** B161: email consent; dispatch additionally requires the wired channel. */
  emailEnabled: z.boolean().default(false),
  quietStartMinute: z.number().int().min(0).max(MINUTE_OF_DAY_MAX).nullable(),
  quietEndMinute: z.number().int().min(0).max(MINUTE_OF_DAY_MAX).nullable(),
  timeZone: z.string().min(1).max(64).nullable(),
}).refine(
  prefs => (prefs.quietStartMinute == null) === (prefs.quietEndMinute == null),
  { message: "Quiet hours need both a start and an end" },
).refine(
  prefs => prefs.quietStartMinute == null || prefs.quietStartMinute !== prefs.quietEndMinute,
  { message: "Quiet hours start and end must differ" },
).refine(
  prefs => prefs.timeZone == null || isValidTimeZone(prefs.timeZone),
  { message: "Unknown time zone" },
)

/**
 * IANA-zone validation at the boundary; the policy itself never trusts it.
 * Batch 114: the single implementation moved to the pure `time-policy`
 * module (shared with the account display-timezone preference); re-exported
 * here so the existing call sites and imports stay stable.
 */
export { isValidTimeZone } from "./time-policy"

export type NotificationPreferencesWriteResult = {
  changed: boolean
  /** The overwrote-before state is returned so the UI can toast the truth. */
  previous: {
    inAppEnabled: boolean
    emailEnabled: boolean
    quietStartMinute: number | null
    quietEndMinute: number | null
    timeZone: string | null
  } | null
}

/**
 * Upsert the member's preferences in the active league. Idempotent by value:
 * saving an identical set reports `changed: false` and rewrites nothing.
 */
export async function saveNotificationPreferencesForMember(
  tenantId: string,
  memberId: string,
  input: unknown,
): Promise<NotificationPreferencesWriteResult> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(memberId)
  const prefs = notificationPreferencesInputSchema.parse(input)

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, memberId),
      ))
      .for("update")
      .limit(1)

    const previous = existing
      ? {
        inAppEnabled: existing.inAppEnabled,
        emailEnabled: existing.emailEnabled,
        quietStartMinute: existing.quietStartMinute,
        quietEndMinute: existing.quietEndMinute,
        timeZone: existing.timeZone,
      }
      : null

    const changed = previous == null
      || previous.inAppEnabled !== prefs.inAppEnabled
      || previous.emailEnabled !== prefs.emailEnabled
      || previous.quietStartMinute !== prefs.quietStartMinute
      || previous.quietEndMinute !== prefs.quietEndMinute
      || previous.timeZone !== prefs.timeZone
    if (!changed) return { changed: false, previous }

    if (existing) {
      await tx.update(notificationPreferences)
        .set({
          inAppEnabled: prefs.inAppEnabled,
          emailEnabled: prefs.emailEnabled,
          quietStartMinute: prefs.quietStartMinute,
          quietEndMinute: prefs.quietEndMinute,
          timeZone: prefs.timeZone,
          updatedAt: new Date(),
        })
        .where(and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, memberId),
        ))
    } else {
      await tx.insert(notificationPreferences).values({
        tenantId,
        userId: memberId,
        inAppEnabled: prefs.inAppEnabled,
        emailEnabled: prefs.emailEnabled,
        quietStartMinute: prefs.quietStartMinute,
        quietEndMinute: prefs.quietEndMinute,
        timeZone: prefs.timeZone,
      })
    }
    return { changed: true, previous }
  })
}
