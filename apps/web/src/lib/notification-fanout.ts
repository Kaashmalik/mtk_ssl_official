import {
  db, fanFollows, notificationJobs, notificationPreferences, users,
} from "@mtk/database"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { FOLLOWER_FANOUT_LIMIT } from "./notification-dispatch"

/**
 * ENH-06-04: durable league fan-out.
 *
 * The producer NEVER sends during the lifecycle request. It writes one job per
 * followed member in the same league, and the bounded worker
 * (`processNotificationJobs`) performs the consent-gated delivery later. If the
 * serverless invocation dies after this insert, the rows remain and the next
 * worker pass delivers them.
 *
 * The `unique(event_id, recipient_user_id, channel)` key makes the producer
 * idempotent: a replayed lifecycle event collides per member instead of
 * sending twice. The fan-out stays bounded by the same honest
 * `FOLLOWER_FANOUT_LIMIT` as before.
 */

const fanoutInputSchema = z.object({
  tenantId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  body: z.string().max(500),
  /** The dedup key doubles as the durable job's event id. */
  eventId: z.string().min(8).max(160),
  /** ENH-06-03 deep link, validated before it can reach stored payloads. */
  matchId: z.string().uuid().optional(),
}).strict()

export type TournamentFollowerFanoutInput = z.input<typeof fanoutInputSchema>

export type TournamentFollowerFanoutResult = {
  /** Followers selected (bounded); not the number actually enqueued. */
  fanout: number
  /** Newly inserted jobs across every consented channel. */
  enqueued: number
  /** Jobs attempted per channel (before replay dedup). */
  channels: { inApp: number; email: number; push: number }
}

/**
 * Enqueue (do not deliver) notices for every active follower of a tournament in
 * ONE league. Followers are read with the tenant predicate, so a cross-tenant
 * follow row can never receive another league's notice.
 *
 * Every follower gets the in-app notice unless they explicitly turned it off
 * (the bell is the baseline channel). Email and push are opt-in: a job is
 * written only when that member's stored preference for THIS league is enabled.
 * The worker still re-reads consent, quiet hours, wiring and recipient
 * eligibility at delivery time, so a producer decision is never the final
 * authority. Quiet hours deliberately do not filter
 * here - they are a timing refusal the durable worker retries.
 */
export async function enqueueTournamentFollowerJobs(
  input: TournamentFollowerFanoutInput,
): Promise<TournamentFollowerFanoutResult> {
  const parsed = fanoutInputSchema.parse(input)

  const followers = await db
    .select({
      userId: fanFollows.userId,
      inAppEnabled: notificationPreferences.inAppEnabled,
      emailEnabled: notificationPreferences.emailEnabled,
      pushEnabled: notificationPreferences.pushEnabled,
    })
    .from(fanFollows)
    .innerJoin(users, and(eq(users.id, fanFollows.userId), eq(users.isActive, true)))
    .leftJoin(notificationPreferences, and(
      eq(notificationPreferences.tenantId, parsed.tenantId),
      eq(notificationPreferences.userId, fanFollows.userId),
    ))
    .where(and(
      eq(fanFollows.tenantId, parsed.tenantId),
      eq(fanFollows.followableType, "tournament"),
      eq(fanFollows.followableId, parsed.tournamentId),
    ))
    .orderBy(desc(fanFollows.createdAt))
    .limit(FOLLOWER_FANOUT_LIMIT)

  const emptyChannels = { inApp: 0, email: 0, push: 0 }
  if (followers.length === 0) {
    return { fanout: 0, enqueued: 0, channels: emptyChannels }
  }

  const data: Record<string, string> = parsed.matchId ? { matchId: parsed.matchId } : {}
  const channels = { ...emptyChannels }
  const rows = followers.flatMap(follower => {
    const jobs: Array<{
      tenantId: string
      recipientUserId: string
      eventId: string
      channel: "in_app" | "email" | "push"
      type: string
      title: string
      body: string
      data: Record<string, string>
    }> = []
    // An absent preference row means the defaults (in-app on, external off),
    // matching the delivery policy; an explicit opt-out is respected here.
    if (follower.inAppEnabled !== false) {
      channels.inApp += 1
      jobs.push({
        tenantId: parsed.tenantId,
        recipientUserId: follower.userId,
        eventId: parsed.eventId,
        channel: "in_app",
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        data,
      })
    }
    if (follower.emailEnabled === true) {
      channels.email += 1
      jobs.push({
        tenantId: parsed.tenantId,
        recipientUserId: follower.userId,
        eventId: parsed.eventId,
        channel: "email",
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        data,
      })
    }
    if (follower.pushEnabled === true) {
      channels.push += 1
      jobs.push({
        tenantId: parsed.tenantId,
        recipientUserId: follower.userId,
        eventId: parsed.eventId,
        channel: "push",
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        data,
      })
    }
    return jobs
  })

  if (rows.length === 0) {
    return { fanout: followers.length, enqueued: 0, channels }
  }

  const inserted = await db
    .insert(notificationJobs)
    .values(rows)
    .onConflictDoNothing({
      target: [notificationJobs.eventId, notificationJobs.recipientUserId, notificationJobs.channel],
    })
    .returning({ id: notificationJobs.id })

  return { fanout: followers.length, enqueued: inserted.length, channels }
}
