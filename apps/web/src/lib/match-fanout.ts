import { db, teams, tournaments } from "@mtk/database"
import { and, eq, inArray } from "drizzle-orm"
import {
  matchEventDecision, matchEventCopy, matchEventDedupKey,
  type MatchFanoutKind,
} from "@mtk/database/lib/match-event-notification"
import { dispatchNotificationToTournamentFollowers } from "./notification-dispatch"

/**
 * FAN-02 match lifecycle fan-out wiring (post-commit, fire-and-forget).
 *
 * The lifecycle writers enqueue this AFTER their transaction commits; delivery
 * can never fail the official record. The shared pure policy decides whether
 * anything fans out at all (published competition, real state change, follower
 * surface exists); only in-app rows are ever written and the 24h dedup applies
 * per type + dedup key.
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

  await dispatchNotificationToTournamentFollowers({
    tenantId: trigger.tenantId,
    // Non-null by construction: the pure decision only notifies with a competition.
    tournamentId: trigger.after.tournamentId as string,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    dedupKey: matchEventDedupKey(trigger.kind, trigger.after.id, iso(trigger.after.scheduledDate)),
  })
}

/** Never throws; delivery can never fail the official record. */
export function queueMatchLifecycleFanout(trigger: MatchFanoutTrigger): void {
  void fanOutMatchLifecycleEvent(trigger).catch(() => {})
}
