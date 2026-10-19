import { randomUUID } from "crypto"
import { db, auditLogs, leagueRegistrations, matches, teams, tournaments,
  type Tournament } from "@mtk/database"
import { and, eq, inArray, sql } from "drizzle-orm"
import { readTournamentConfiguration } from "@mtk/database/lib/tournament-configuration"
import { lockOwnerContext } from "@/lib/tournament-lifecycle"
import { planHybridFixtures, planKnockoutFirstRound, planLeagueFixtures, knockoutStages,
  rankApprovedTeamIds, resolveSeededSlots, type PlannedStructure } from "@/lib/fixture-planning"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type MatchRow = typeof matches.$inferSelect

function planForFormat(format: string, slots: string[]): PlannedStructure {
  if (format === "knockout") return planKnockoutFirstRound(slots)
  if (format === "hybrid") return planHybridFixtures(slots)
  return planLeagueFixtures(slots) // league (+ legacy round_robin)
}

// Wizard match types map to the match_format enum; tape-ball/custom play as
// custom with the configured overs.
function matchFormatFor(configMatchType: string): "t20" | "odi" | "custom" {
  if (configMatchType === "t20") return "t20"
  if (configMatchType === "odi") return "odi"
  return "custom"
}

/**
 * Generates a tournament's fixtures from its approved registrations
 * (COMP-04), binding them to the saved bracket seed order where valid.
 * Everything happens in one locked transaction: account -> tournament row
 * (FOR UPDATE) -> re-checks. Fail-closed on: archived/completed tournaments,
 * any pre-existing fixtures (regeneration is a deliberate reshaping, never a
 * silent overwrite), missing wizard configuration, fewer than two approved
 * teams, capacity violations and knockout formats without a valid power-of-
 * two team count. Structural rest/conflict checks (one match per team per
 * round, every pairing distinct, no self-matches) are enforced by the pure
 * planners in lib/fixture-planning. Creating fixtures starts the competition:
 * the tournament moves to "live" and registration closes. Match dates are
 * deliberately left unscheduled — rescheduling is COMP-07.
 */
export async function generateTournamentFixtures(clerkId: string, tenantId: string, tournamentId: string): Promise<{
  tournament: Tournament
  fixtures: MatchRow[]
  rounds: string[]
}> {
  return db.transaction(async (tx: Tx) => {
    const context = await lockOwnerContext(tx, clerkId, tenantId)
    await tx.execute(sql`SELECT ${tournaments.id} FROM ${tournaments}
      WHERE ${and(eq(tournaments.id, tournamentId), eq(tournaments.tenantId, tenantId))} FOR UPDATE`)
    const tournament = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.id, tournamentId), eq(tournaments.tenantId, tenantId)) })
    if (!tournament || tournament.id !== tournamentId || tournament.tenantId !== tenantId) {
      throw new Error("Tournament not found")
    }
    if (tournament.status === "cancelled") throw new Error("Tournament is archived")
    if (tournament.status === "completed") throw new Error("Tournament is already completed")

    // The tournament-row lock serializes generations, so this re-check after
    // the lock is race-free: two concurrent runs cannot both create fixtures.
    const existingFixture = await tx.query.matches.findFirst({ columns: { id: true },
      where: and(eq(matches.tournamentId, tournamentId), eq(matches.tenantId, tenantId)) })
    if (existingFixture) {
      throw new Error("Fixtures were already generated for this tournament — cancel individual fixtures to reshape it")
    }

    const config = readTournamentConfiguration(tournament.rules)
    if (!config) throw new Error("Finish the tournament setup wizard before generating fixtures")

    const registrations = await tx.select({
      teamId: leagueRegistrations.teamId,
      approvedAt: leagueRegistrations.approvedAt,
    }).from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.tournamentId, tournamentId),
        eq(leagueRegistrations.status, "approved")))
    const ranked = rankApprovedTeamIds(registrations)
    if (ranked.length < 2) throw new Error("Need at least two approved teams before generating fixtures")
    if (tournament.maxTeams !== null && ranked.length > tournament.maxTeams) {
      throw new Error("More teams are approved than the tournament capacity allows")
    }

    // Knockout brackets require an exact power-of-two participant count; that
    // check comes first so a wrong team count never masquerades as a seeding
    // problem. A wrong saved seed order must then block generation instead of
    // silently re-seeding. Group formats tolerate a stale seed order (ranking
    // order is used and recorded in the audit).
    if (tournament.format === "knockout") knockoutStages(ranked.length)
    const slots = resolveSeededSlots({
      rankedTeamIds: ranked,
      seedOrder: config.seedOrder,
      strict: tournament.format === "knockout",
    })

    const teamRows = await tx.select({ id: teams.id, isActive: teams.isActive })
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, slots)))
    const available = new Map(teamRows.map(team => [team.id, team.isActive === true]))
    if (slots.some(id => available.get(id) !== true)) {
      throw new Error("An approved team is no longer available in this league")
    }

    const plan = planForFormat(tournament.format, slots)
    const matchFormat = matchFormatFor(config.matchType)

    const fixtures: MatchRow[] = []
    let matchNumber = 0
    for (const fixture of plan.fixtures) {
      matchNumber += 1
      const [row] = await tx.insert(matches).values({
        tenantId,
        tournamentId,
        teamAId: fixture.teamAId,
        teamBId: fixture.teamBId,
        matchNumber,
        matchType: fixture.matchType,
        groupLabel: fixture.groupName,
        matchFormat,
        totalOvers: config.overs,
        status: "scheduled",
        createdBy: context.actor.id,
      }).returning()
      if (!row) throw new Error("Could not save generated fixture")
      fixtures.push(row)
    }

    const startCompetition = tournament.status !== "live"
    const [updated] = startCompetition
      ? await tx.update(tournaments)
        .set({ status: "live", registrationOpen: false, updatedAt: new Date() })
        .where(and(eq(tournaments.id, tournamentId), eq(tournaments.tenantId, tenantId))).returning()
      : [tournament]
    if (!updated) throw new Error("Tournament changed. Reload before generating fixtures.")

    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: context.actor.id, actorRole: context.member.role,
      method: "TOURNAMENT_FIXTURES_GENERATE", path: `/dashboard/tournaments/${tournamentId}`,
      statusCode: "200",
      payload: {
        resourceId: tournamentId,
        before: { status: tournament.status },
        after: { status: updated.status, matchCount: fixtures.length,
          registrationOpen: updated.registrationOpen },
        changedFields: startCompetition ? ["status", "registrationOpen", "matches"] : ["matches"],
        format: tournament.format,
        rounds: plan.rounds,
        savedSeedOrderApplied: slots.join(",") !== ranked.join(","),
      },
    })

    return { tournament: updated as Tournament, fixtures, rounds: plan.rounds }
  }, { isolationLevel: "read committed" })
}
