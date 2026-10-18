import { db, notifications, notificationPreferences, fanFollows, users } from "@mtk/database"
import { and, eq, gte, sql, desc } from "drizzle-orm"
import { z } from "zod"
import { memberDeliveryDecision, MINUTE_OF_DAY_MAX } from "@mtk/database/lib/notification-policy"
import { isValidTimeZone } from "./time-policy"

/**
 * FAN-02 notification dispatch (locked writer).
 *
 * The single path notifications flow through: consent gate first, dedup next,
 * then the insert. A row is only written when the shared policy explicitly
 * allows the channel NOW — nothing is written "for later delivery", because a
 * row that promises a send no one performs would be a fabricated delivery.
 *
 * With no external provider integrated, only `in_app` rows are ever written;
 * email/push/sms honestly resolve to `channel_unwired` and produce nothing.
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
})

export type DispatchResult = {
  written: boolean
  /** Always present: `ok` on a write, otherwise the honest refusal reason. */
  reason: "ok" | "consent_off" | "quiet_hours" | "channel_unwired" | "deduplicated"
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

  return db.transaction(async (tx) => {
    const [prefs] = await tx
      .select({
        inAppEnabled: notificationPreferences.inAppEnabled,
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
      channel: "in_app",
      prefs: prefs ?? null,
      now,
    })
    if (!decision.allowed) return { written: false, reason: decision.reason }

    const [duplicate] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, parsed.tenantId),
        eq(notifications.userId, parsed.memberId),
        eq(notifications.type, parsed.type),
        eq(notifications.channel, "in_app"),
        gte(notifications.createdAt, quietCutoff),
        sql`${notifications.data} ->> 'dedupKey' = ${parsed.dedupKey}`,
      ))
      .limit(1)
    if (duplicate) return { written: false, reason: "deduplicated" }

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
  })
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
        quietStartMinute: existing.quietStartMinute,
        quietEndMinute: existing.quietEndMinute,
        timeZone: existing.timeZone,
      }
      : null

    const changed = previous == null
      || previous.inAppEnabled !== prefs.inAppEnabled
      || previous.quietStartMinute !== prefs.quietStartMinute
      || previous.quietEndMinute !== prefs.quietEndMinute
      || previous.timeZone !== prefs.timeZone
    if (!changed) return { changed: false, previous }

    if (existing) {
      await tx.update(notificationPreferences)
        .set({
          inAppEnabled: prefs.inAppEnabled,
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
        quietStartMinute: prefs.quietStartMinute,
        quietEndMinute: prefs.quietEndMinute,
        timeZone: prefs.timeZone,
      })
    }
    return { changed: true, previous }
  })
}
