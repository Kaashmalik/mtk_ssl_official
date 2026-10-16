import { randomUUID } from "crypto"
import { db, matches, users, tenants, userTenantRoles, teams, tournaments, venues, auditLogs,
  matchInnings, matchBalls, scoringEvents, scorecardProjections,
  battingScorecards, bowlingScorecards, fieldingScorecards, checkPlanFeature, membershipGrantsAccess,
  type PlanKey } from "@mtk/database"
import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { findSchedulingConflicts } from "@/lib/rescheduling"

// Accept the existing datetime-local form and ISO timestamps, but never JS's
// permissive rollover (e.g. February 30), unbounded text or Invalid Date.
const scheduledDate = z.string().max(40).refine(value => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value)
  if (!parts) return false
  const [, year, month, day, hour, minute, rawSecond] = parts.map(Number)
  const second = Number.isNaN(rawSecond) ? 0 : rawSecond
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days
    && hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(new Date(value).getTime())
}, "Invalid scheduled date")

export const matchMetadataSchema = z.object({
  tournamentId: z.string().uuid().nullish(), teamAId: z.string().uuid(), teamBId: z.string().uuid(),
  venueId: z.string().uuid().nullish(),
  matchFormat: z.enum(["t20", "odi", "test", "t10", "custom"]).default("t20"),
  matchType: z.enum(["group", "knockout", "final", "semi_final", "quarter_final", "friendly", "practice"]).default("group"),
  totalOvers: z.number().int().min(1).max(450).default(20), scheduledDate: scheduledDate.nullish(),
  matchNumber: z.number().int().min(1).max(2147483647).nullish(),
  umpire1: z.string().trim().max(200).nullish(), umpire2: z.string().trim().max(200).nullish(),
}).strict()
export const streamCommandSchema = z.object({
  source: z.enum(["facebook", "youtube", "rtmp", "webrtc"]), url: z.string().trim().max(2048).url(),
}).strict().refine(({ source, url }) => {
  try {
    const parsed = new URL(url)
    return !parsed.username && !parsed.password
      && (parsed.protocol === "https:" || (source === "rtmp" && ["rtmp:", "rtmps:"].includes(parsed.protocol)))
  } catch { return false }
}, "Use a secure playback URL without embedded credentials")

type Metadata = z.infer<typeof matchMetadataSchema>
type Match = typeof matches.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Command = { kind: "create"; data: Metadata } | { kind: "update"; id: string; data: Partial<Metadata> }
  | { kind: "cancel" | "stream-end"; id: string }
  | { kind: "stream-start"; id: string; data: z.infer<typeof streamCommandSchema> }
  | { kind: "reschedule"; id: string; data: { scheduledDate: string; minRestHours?: number } }

async function requireOwner(tx: Tx, clerkId: string, tenantId: string) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: match management account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const member = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
  if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId
    || !membershipGrantsAccess(member) || member.role !== "league_owner") {
    throw new Error("Forbidden: your match management access changed")
  }
  return { actor, league, member }
}

async function requireUnstarted(tx: Tx, match: Match) {
  if (match.status !== "scheduled" || match.startDate || match.endDate || match.tossWinnerId
    || match.tossDecision || match.winnerId || match.result || match.manOfMatchId) {
    throw new Error("Only an unstarted scheduled fixture can be edited or cancelled")
  }
  // No hard deletes. Also reject edits/cancellation if legacy writers left
  // scoring evidence while the status still says scheduled. Participating
  // scoring writers take the match lock before creating any of this evidence.
  const hasHistory = await tx.query.matchInnings.findFirst({ columns: { id: true }, where: eq(matchInnings.matchId, match.id) })
    || await tx.query.matchBalls.findFirst({ columns: { id: true }, where: eq(matchBalls.matchId, match.id) })
    || await tx.query.scoringEvents.findFirst({ columns: { id: true }, where: eq(scoringEvents.matchId, match.id) })
    || await tx.query.scorecardProjections.findFirst({ columns: { id: true }, where: eq(scorecardProjections.matchId, match.id) })
    || await tx.query.battingScorecards.findFirst({ columns: { id: true }, where: eq(battingScorecards.matchId, match.id) })
    || await tx.query.bowlingScorecards.findFirst({ columns: { id: true }, where: eq(bowlingScorecards.matchId, match.id) })
    || await tx.query.fieldingScorecards.findFirst({ columns: { id: true }, where: eq(fieldingScorecards.matchId, match.id) })
  if (hasHistory) throw new Error("Fixture has scoring history; use an audited correction workflow")
}

async function requireReferences(tx: Tx, tenantId: string, data: Pick<Match, "teamAId" | "teamBId" | "tournamentId" | "venueId">) {
  if (data.teamAId === data.teamBId) throw new Error("A team cannot play against itself")
  const ids = [data.teamAId, data.teamBId].sort()
  await tx.execute(sql`SELECT ${teams.id} FROM ${teams}
    WHERE ${and(eq(teams.tenantId, tenantId), inArray(teams.id, ids))} ORDER BY ${teams.id} FOR SHARE`)
  for (const id of ids) {
    const team = await tx.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.tenantId, tenantId)) })
    if (!team || team.id !== id || team.tenantId !== tenantId || team.isActive !== true) {
      throw new Error("Match team is unavailable in this league")
    }
  }
  // Shared resource locks follow sorted teams, never the reverse in this writer.
  if (data.tournamentId) {
    await tx.execute(sql`SELECT ${tournaments.id} FROM ${tournaments}
      WHERE ${and(eq(tournaments.id, data.tournamentId), eq(tournaments.tenantId, tenantId))} FOR SHARE`)
    const tournament = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.id, data.tournamentId), eq(tournaments.tenantId, tenantId)) })
    if (!tournament || tournament.id !== data.tournamentId || tournament.tenantId !== tenantId
      || !["draft", "registration", "live"].includes(tournament.status)) throw new Error("Tournament is unavailable in this league")
  }
  if (data.venueId) {
    await tx.execute(sql`SELECT ${venues.id} FROM ${venues}
      WHERE ${and(eq(venues.id, data.venueId), eq(venues.tenantId, tenantId))} FOR SHARE`)
    const venue = await tx.query.venues.findFirst({ where: and(eq(venues.id, data.venueId), eq(venues.tenantId, tenantId)) })
    if (!venue || venue.id !== data.venueId || venue.tenantId !== tenantId || venue.isActive !== true) {
      throw new Error("Venue is unavailable in this league")
    }
  }
}

// Do not copy playback URLs/keys into audit payloads.
function snapshot(match: Match) {
  return { teamAId: match.teamAId, teamBId: match.teamBId, tournamentId: match.tournamentId,
    venueId: match.venueId, matchFormat: match.matchFormat, matchType: match.matchType,
    totalOvers: match.totalOvers, scheduledDate: match.scheduledDate, matchNumber: match.matchNumber,
    umpire1: match.umpire1, umpire2: match.umpire2, status: match.status,
    streamSource: match.streamSource, streamStatus: match.streamStatus, hasStreamUrl: !!match.liveStreamUrl }
}

/** Match -> actor -> league -> membership -> resources. Creation has no existing
 * match to lock; it never acquires an existing match lock after the actor lock.
 */
export async function manageMatch(clerkId: string, tenantId: string, command: Command) {
  return db.transaction(async tx => {
    let existing: Match | undefined
    if (command.kind !== "create") {
      const key = and(eq(matches.id, command.id), eq(matches.tenantId, tenantId))
      await tx.execute(sql`SELECT ${matches.id} FROM ${matches} WHERE ${key} FOR UPDATE`)
      existing = await tx.query.matches.findFirst({ where: key })
      if (!existing || existing.id !== command.id || existing.tenantId !== tenantId) throw new Error("Match not found")
    }
    const { actor, league, member } = await requireOwner(tx, clerkId, tenantId)
    let updated: Match | undefined
    if (command.kind === "create") {
      await requireReferences(tx, tenantId, { ...command.data,
        tournamentId: command.data.tournamentId ?? null, venueId: command.data.venueId ?? null })
      const { scheduledDate, ...data } = command.data
      const [created] = await tx.insert(matches).values({ ...data, tenantId, status: "scheduled",
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null, createdBy: actor.id }).returning()
      updated = created
    } else {
      const current = existing!
      let patch: Partial<Match>
      if (command.kind === "update") {
        await requireUnstarted(tx, current)
        const { scheduledDate, ...fields } = command.data
        const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Omit<Partial<Metadata>, "scheduledDate">
        await requireReferences(tx, tenantId, { ...current, ...data })
        patch = { ...data, ...(scheduledDate !== undefined
          ? { scheduledDate: scheduledDate ? new Date(scheduledDate) : null } : {}) }
        if (Object.keys(data).length === 0 && scheduledDate === undefined) return current
      } else if (command.kind === "reschedule") {
        await requireUnstarted(tx, current)
        const proposed = scheduledDate.parse(command.data.scheduledDate)
        // COMP-07 conflict/rest checks against the league's other fixtures.
        const tenantFixtures = await tx.select({
          matchId: matches.id, teamAId: matches.teamAId, teamBId: matches.teamBId,
          venueId: matches.venueId, scheduledDate: matches.scheduledDate, status: matches.status,
        }).from(matches).where(eq(matches.tenantId, tenantId))
        const conflicts = findSchedulingConflicts({
          targetMatchId: current.id,
          teamAId: current.teamAId,
          teamBId: current.teamBId,
          venueId: current.venueId,
          proposedStart: new Date(proposed),
          fixtures: tenantFixtures,
          minRestHours: command.data.minRestHours,
        })
        if (conflicts.length > 0) {
          const first = conflicts[0].reason
          throw new Error(`Rescheduling blocked: ${first === "team_rest"
            ? "a participating team already has a fixture within the rest window"
            : "the venue is already in use within the rest window"} (${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"})`)
        }
        patch = { scheduledDate: new Date(proposed) }
      } else if (command.kind === "cancel") {
        if (current.status === "cancelled") return current
        await requireUnstarted(tx, current)
        patch = { status: "cancelled", streamStatus: current.streamStatus === "live" ? "ended" : current.streamStatus }
      } else if (command.kind === "stream-start") {
        checkPlanFeature({ plan: league.plan as PlanKey, feature: "liveStreaming", label: "Live streaming" })
        if (!["scheduled", "toss", "live", "innings_break"].includes(current.status)) throw new Error("Cannot start a stream for an ended match")
        if (current.streamStatus === "live" && current.streamSource === command.data.source && current.liveStreamUrl === command.data.url) return current
        patch = { liveStreamUrl: command.data.url, streamSource: command.data.source, streamStatus: "live" }
      } else {
        // Allow cleanup after a downgrade or completed match, but still authorize.
        if (current.streamStatus === "ended") return current
        patch = { streamStatus: "ended" }
      }
      const [saved] = await tx.update(matches).set({ ...patch, updatedAt: new Date() })
        .where(and(eq(matches.id, current.id), eq(matches.tenantId, tenantId))).returning()
      updated = saved
    }
    if (!updated) throw new Error("Match changed. Reload before saving.")
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: member.role,
      method: `MATCH_${command.kind.toUpperCase().replaceAll("-", "_")}`, path: `/dashboard/matches/${updated.id}`,
      statusCode: "200", payload: { matchId: updated.id, before: existing ? snapshot(existing) : null, after: snapshot(updated) } })
    return updated
  }, { isolationLevel: "read committed" })
}
