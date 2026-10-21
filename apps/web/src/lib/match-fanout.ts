import { db, teams, tournaments } from "@mtk/database"
import { and, eq, inArray } from "drizzle-orm"
import {
  matchEventDecision, matchEventCopy, matchEventDedupKey,
  type MatchFanoutKind,
} from "@mtk/database/lib/match-event-notification"
import { enqueueTournamentFollowerJobs } from "./notification-fanout"

/**
 * FAN-02 match lifecycle fan-out wiring (post-commit producer).
 *
 * ENH-06-04: this now only ENQUEUES durable per-follower jobs; it performs no
 * provider HTTP. The lifecycle writers await it after their transaction
 * commits, and a failure is swallowed - delivery can never fail the official
 * record. The worker delivers later, so a terminated invocation leaves the
 * owed notices in the outbox instead of losing them. The shared pure policy
 * decides whether anything fans out at all (published competition, real state
 * change, follower surface exists); jobs stay in-app and the durable event id
 * keeps a replay idempotent per follower.
 */

export type MatchLifecycleSnapshot = {
  id: string
  tournamentId: string | null
  teamAId: string
  teamBId: string
  status: string
  scheduledDate: Date | null
}

export type MatchFanoutTrigger = {
  tenantId: string
  kind: MatchFanoutKind
  before: MatchLifecycleSnapshot | null
  after: MatchLifecycleSnapshot
}

/** Deterministic UTC presentation - honest about the zone rather than guessing the fan's. */
function formatWhenUtc(date: Date): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
  }).format(date)
  return `${text} UTC`
}

export function buildLifecycleSnapshot(row: {
  id: string; tournamentId: string | null; teamAId: string; teamBId: string
  status: string; scheduledDate: Date | null
}): MatchLifecycleSnapshot {
  return {
    id: row.id, tournamentId: row.tournamentId, teamAId: row.teamAId,
    teamBId: row.teamBId, status: row.status, scheduledDate: row.scheduledDate,
  }
}

export async function fanOutMatchLifecycleEvent(trigger: MatchFanoutTrigger): Promise<void> {
  const iso = (date: Date | null) => (date ? date.toISOString() : null)

  // (1) The competition row decides publication; a vanished competition reads unpublished.
  const tournamentStatus = trigger.after.tournamentId
    ? await db
        .select({ status: tournaments.status })
        .from(tournaments)
        .where(and(eq(tournaments.id, trigger.after.tournamentId), eq(tournaments.tenantId, trigger.tenantId)))
        .limit(1)
        .then(rows => rows[0]?.status ?? null)
    : null

  // (2) Pure decision - replays and non-events stop here.
  const decision = matchEventDecision({
    kind: trigger.kind,
    tournamentId: trigger.after.tournamentId,
    tournamentStatus,
    statusBefore: trigger.before?.status ?? null,
    statusAfter: trigger.after.status,
    scheduledBefore: iso(trigger.before?.scheduledDate ?? null),
    scheduledAfter: iso(trigger.after.scheduledDate),
  })
  if (!decision.notify) return

  // (3) Team names for the copy; a missing side fails the fan-out closed.
  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, trigger.tenantId), inArray(teams.id, [trigger.after.teamAId, trigger.after.teamBId])))
  const homeName = teamRows.find(row => row.id === trigger.after.teamAId)?.name
  const awayName = teamRows.find(row => row.id === trigger.after.teamBId)?.name
  if (!homeName || !awayName) return

  const whenText = trigger.kind === "reschedule" && trigger.after.scheduledDate
    ? formatWhenUtc(trigger.after.scheduledDate)
    : undefined
  const copy = matchEventCopy(trigger.kind, { homeName, awayName, whenText })

  await enqueueTournamentFollowerJobs({
    tenantId: trigger.tenantId,
    // Non-null by construction: the pure decision only notifies with a competition.
    tournamentId: trigger.after.tournamentId as string,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    // ENH-06-04: the dedup key is the durable event id, so a replayed lifecycle
    // event collides per follower instead of queuing a second notice.
    eventId: matchEventDedupKey(trigger.kind, trigger.after.id, iso(trigger.after.scheduledDate)),
    // ENH-06-03: the notice points at the match it is about, so the bell item
    // (and the push payload) can deep-link into it. The recipient's own access
    // rules decide whether that match opens for them.
    matchId: trigger.after.id,
  })
}

/**
 * The enqueue is DB-only (no provider HTTP), so it is safe to AWAIT in the
 * request that already committed the official record. Errors are still
 * swallowed: notification delivery is ancillary and must never turn a saved
 * match into a failed request.
 */
export async function queueMatchLifecycleFanout(trigger: MatchFanoutTrigger): Promise<void> {
  await fanOutMatchLifecycleEvent(trigger).catch(() => {})
}
