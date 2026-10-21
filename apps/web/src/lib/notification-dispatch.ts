import { db, notifications, notificationPreferences, fanFollows, users, tenants, pushTokens } from "@mtk/database"
import { and, eq, gte, sql, desc } from "drizzle-orm"
import { z } from "zod"
import { memberDeliveryDecision, MINUTE_OF_DAY_MAX } from "@mtk/database/lib/notification-policy"
import { isValidTimeZone } from "./time-policy"
import { getTenantBranding } from "./tenant"
import { brandPresentation, type BrandPresentation } from "./brand-presentation"
import { buildNotificationEmail, notificationEmailFrom, notificationEmailReady, type NotificationEmail } from "./notification-email"
import { notificationPushReady, sendPushToTokens } from "./push-delivery"

/**
 * FAN-02 notification dispatch (locked writer).
 *
 * The single path notifications flow through: consent gate first, dedup next,
 * then the insert. A row is only written when the shared policy explicitly
 * allows the channel NOW — nothing is written "for later delivery", because a
 * row that promises a send no one performs would be a fabricated delivery.
 *
 * Channels: `in_app` always. Email (B161) and push (B162) only when the
 * member consented (notification_preferences.email_enabled / push_enabled)
 * AND the deployment wired the channel. Consent without wiring reads
 * channel_unwired and writes nothing. The provider attempt happens AFTER the
 * consent transaction commits (provider HTTP never holds the row lock) and
 * its outcome is recorded honestly on the row: `provider_accepted` means the
 * provider took the message, never that a device showed it or a human read
 * it. SMS remains honestly unwired.
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
  channel: z.enum(["in_app", "email", "push"]).default("in_app"),
  /**
   * ENH-06-03: the match this notification is about, when there is one. The id
   * is validated here and becomes a DEEP LINK in the stored payload and in the
   * push message data - the client resolves it against its own access rules,
   * so the link can only ever point at a match the recipient may open.
   */
  matchId: z.string().uuid().optional(),
})

export type DispatchResult = {
  written: boolean
  /** Always present: `ok` on a write, otherwise the honest refusal reason. */
  reason: "ok" | "consent_off" | "quiet_hours" | "channel_unwired" | "deduplicated" | "no_recipient"
  /** EMAIL/PUSH only: the honest, post-commit provider outcome (never "delivered"). */
  sendState?: "provider_accepted" | "provider_refused"
}

type EmailDeliveryContext = {
  rowId: string
  to: string
  leagueName: string
  brand: BrandPresentation | null
  email: NotificationEmail
}

type PushDeliveryContext = {
  rowId: string
  tokens: string[]
  content: { title: string; body: string; type: string; tenantId: string; dedupKey: string; matchId?: string }
  tokenCount: number
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
    DispatchResult & { email?: EmailDeliveryContext; push?: PushDeliveryContext }
  > => {
    const [prefs] = await tx
      .select({
        inAppEnabled: notificationPreferences.inAppEnabled,
        emailEnabled: notificationPreferences.emailEnabled,
        pushEnabled: notificationPreferences.pushEnabled,
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

    const wiring = parsed.channel === "email"
      ? { email: notificationEmailReady() }
      : parsed.channel === "push"
        ? { push: notificationPushReady() }
        : undefined
    const decision = memberDeliveryDecision({
      channel: parsed.channel,
      prefs: prefs ?? null,
      now,
      wiring,
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
        data: { dedupKey: parsed.dedupKey, ...(parsed.matchId ? { matchId: parsed.matchId } : {}) },
      })
      return { written: true, reason: "ok" }
    }

    // EMAIL (B161): an active account with a real address is required;
    // consent was already proven above by the same policy that gates the
    // channel.
    if (parsed.channel === "email") {
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
      data: { dedupKey: parsed.dedupKey, deliveryState: "queued", ...(parsed.matchId ? { matchId: parsed.matchId } : {}) },
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
    }

  // PUSH (B162): consent + wiring already proven; still need at least one
  // active device token. The ledger row carries tokenCount so the bounded
  // fan-out is inspectable.
  const deviceRows = await tx
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(and(
      eq(pushTokens.userId, parsed.memberId),
      eq(pushTokens.isActive, true),
    ))
    .limit(10)
  if (deviceRows.length === 0) return { written: false, reason: "no_recipient" }

  const [pushRow] = await tx.insert(notifications).values({
    tenantId: parsed.tenantId,
    userId: parsed.memberId,
    type: parsed.type,
    channel: "push",
    title: parsed.title,
    body: parsed.body,
    data: { dedupKey: parsed.dedupKey, deliveryState: "queued", tokenCount: deviceRows.length, ...(parsed.matchId ? { matchId: parsed.matchId } : {}) },
  }).returning({ id: notifications.id })

  return {
    written: true,
    reason: "ok",
    push: {
      rowId: pushRow.id,
      tokens: deviceRows.map((d) => d.token),
      content: {
        title: parsed.title,
        body: parsed.body,
        type: parsed.type,
        tenantId: parsed.tenantId,
        dedupKey: parsed.dedupKey,
        ...(parsed.matchId ? { matchId: parsed.matchId } : {}),
      },
      tokenCount: deviceRows.length,
    },
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

  // PUSH settle (B162/B163): one bounded Expo API call after commit; the
  // partial outcome is summarized on the row rather than silently treated as
  // full success or full failure. Accepted tickets keep their receipt ids and
  // the token each id belongs to, so the B163 receipts chase can map a late
  // per-device verdict (e.g. DeviceNotRegistered) back to its token.
  if (result.written && "push" in result && result.push) {
    const { push: delivery } = result
    const outcome = await sendPushToTokens(delivery.tokens, delivery.content)
    let data: Record<string, unknown>
    if (outcome.state === "provider_accepted") {
      // receiptTokens pairs 1:1 with receiptIds (the token each accepted
      // ticket belongs to, same order) so the B163 receipts chase can map a
      // late per-device verdict back to its token. If any ok ticket came
      // WITHOUT an id, alignment is impossible - omit the pairing rather
      // than store a lie.
      const aligned = outcome.receiptIds.length === outcome.ok
      data = {
        dedupKey: parsed.dedupKey,
        deliveryState: "provider_accepted" as const,
        tokenCount: delivery.tokenCount,
        ok: outcome.ok,
        receiptIds: outcome.receiptIds,
        ...(aligned ? { receiptTokens: outcome.receiptIds.map((_, i) => delivery.tokens[i]) } : {}),
      }
    } else {
      data = {
        dedupKey: parsed.dedupKey,
        deliveryState: "provider_refused" as const,
        tokenCount: delivery.tokenCount,
        deliveryError: outcome.error,
      }
    }
    try {
      await db.update(notifications)
        .set({ data })
        .where(eq(notifications.id, delivery.rowId))
    } catch {
      // The send DID happen; only the ledger update failed. The honest state
      // stays "unknown outcome" on the wire — never overwritten to accepted.
      return { written: true, reason: "ok", sendState: outcome.state }
    }
    return { written: true, reason: "ok", sendState: outcome.state }
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
  /**
   * ENH-06-03: the match this notice is about, when there is one. It becomes
   * a DEEP LINK in each member's bell item - the recipient's own access rules
   * decide whether the match opens.
   */
  matchId?: string
}): Promise<{ fanout: number; written: number }> {
  z.string().uuid().parse(input.tenantId)
  z.string().uuid().parse(input.tournamentId)
  if (input.matchId) z.string().uuid().parse(input.matchId)
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
        ...(input.matchId ? { matchId: input.matchId } : {}),
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
  /**
   * B161: email consent; dispatch additionally requires the wired channel.
   *
   * ENH-06-03: OPTIONAL on purpose. A write that does not mention a channel
   * keeps the stored consent instead of overwriting it with the fail-closed
   * default - an absent value is "unknown", never "revoked". The dispatch
   * policy still treats an unknown/absent consent as OFF.
   */
  emailEnabled: z.boolean().optional(),
  /** B162: push consent; dispatch additionally requires the wired channel. */
  pushEnabled: z.boolean().optional(),
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
    pushEnabled: boolean
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
        pushEnabled: existing.pushEnabled,
        quietStartMinute: existing.quietStartMinute,
        quietEndMinute: existing.quietEndMinute,
        timeZone: existing.timeZone,
      }
      : null

    // ENH-06-03: an unspecified channel consent is UNKNOWN, not revoked. The
    // stored value survives a write that did not mention it; with no stored
    // row the channel stays off (fail-closed default).
    const resolved = {
      inAppEnabled: prefs.inAppEnabled,
      emailEnabled: prefs.emailEnabled ?? previous?.emailEnabled ?? false,
      pushEnabled: prefs.pushEnabled ?? previous?.pushEnabled ?? false,
      quietStartMinute: prefs.quietStartMinute,
      quietEndMinute: prefs.quietEndMinute,
      timeZone: prefs.timeZone,
    }

    const changed = previous == null
      || previous.inAppEnabled !== resolved.inAppEnabled
      || previous.emailEnabled !== resolved.emailEnabled
      || previous.pushEnabled !== resolved.pushEnabled
      || previous.quietStartMinute !== resolved.quietStartMinute
      || previous.quietEndMinute !== resolved.quietEndMinute
      || previous.timeZone !== resolved.timeZone
    if (!changed) return { changed: false, previous }

    if (existing) {
      await tx.update(notificationPreferences)
        .set({
          inAppEnabled: resolved.inAppEnabled,
          emailEnabled: resolved.emailEnabled,
          pushEnabled: resolved.pushEnabled,
          quietStartMinute: resolved.quietStartMinute,
          quietEndMinute: resolved.quietEndMinute,
          timeZone: resolved.timeZone,
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
        inAppEnabled: resolved.inAppEnabled,
        emailEnabled: resolved.emailEnabled,
        pushEnabled: resolved.pushEnabled,
        quietStartMinute: resolved.quietStartMinute,
        quietEndMinute: resolved.quietEndMinute,
        timeZone: resolved.timeZone,
      })
    }
    return { changed: true, previous }
  })
}
