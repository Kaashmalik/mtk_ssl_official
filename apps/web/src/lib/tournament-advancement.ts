import { randomUUID } from "crypto"
import { db, auditLogs, matches, tournaments, type Tournament } from "@mtk/database"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import { readTournamentConfiguration } from "@mtk/database/lib/tournament-configuration"
import { lockOwnerContext } from "@/lib/tournament-lifecycle"
import { planKnockoutAdvancement } from "@/lib/fixture-planning"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type MatchRow = typeof matches.$inferSelect

/**
 * Advances a knockout tournament to its next bracket stage once every
 * fixture has a decided result (COMP-05). One locked, audited transaction:
 * account -> league/membership -> tournament row (FOR UPDATE). Fail-closed
 * when the tournament is not live, when configuration is missing, or when
 * any fixture is undecided/no-result — a stage is never planned over
 * incomplete results. When the final is decided the tournament transitions
 * live -> completed (an idempotent claim, never touching a cancelled
 * tournament). Advance only supports the knockout format today: hybrid
 * group-to-knockout progression needs persisted group labels (the matches
 * table has no group column) and league formats have a single completed
 * stage by definition.
 */
export async function advanceKnockoutTournament(clerkId: string, tenantId: string, tournamentId: string): Promise<{
  tournament: Tournament
  stage?: string
  created?: MatchRow[]
  completed?: boolean
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
    if (tournament.status === "draft" || tournament.status === "registration") {
      throw new Error("Generate fixtures before advancing the tournament")
    }

    const fixtures = await tx.select({
      id: matches.id, matchNumber: matches.matchNumber, status: matches.status,
      winnerId: matches.winnerId,
    }).from(matches)
      .where(and(eq(matches.tournamentId, tournamentId), eq(matches.tenantId, tenantId)))
      .orderBy(asc(matches.matchNumber))

    if (tournament.status === "completed") {
      return { tournament } // idempotent: already through the final
    }

    if (tournament.format !== "knockout") {
      throw new Error("Advancement currently supports knockout tournaments only")
    }

    // Legacy manual matches may have a null match number; mapping it to 0
    // keeps them deterministically ordered and the chain check fail-closed.
    const plan = planKnockoutAdvancement(fixtures.map(fixture => ({
      matchNumber: fixture.matchNumber ?? 0,
      status: fixture.status,
      winnerId: fixture.winnerId,
    })))

    if (plan.kind === "complete") {
      const [updated] = await tx.update(tournaments)
        .set({ status: "completed", championTeamId: plan.championId, updatedAt: new Date() })
        .where(and(eq(tournaments.id, tournamentId), eq(tournaments.tenantId, tenantId),
          ne(tournaments.status, "completed"))).returning()
      if (!updated) throw new Error("Tournament changed. Reload before advancing.")
      await tx.insert(auditLogs).values({
        requestId: randomUUID(), tenantId, actorId: context.actor.id, actorRole: context.member.role,
        method: "TOURNAMENT_ADVANCE", path: `/dashboard/tournaments/${tournamentId}`,
        statusCode: "200",
        payload: { resourceId: tournamentId, before: { status: tournament.status },
          after: { status: "completed", championTeamId: plan.championId },
          changedFields: ["status", "championTeamId"],
          format: tournament.format, stage: "Final decided" },
      })
      return { tournament: updated as Tournament, completed: true, stage: "Final decided" }
    }

    const config = readTournamentConfiguration(tournament.rules)
    if (!config) throw new Error("Finish the tournament setup wizard before advancing fixtures")

    const nextNumber = Math.max(...fixtures.map(fixture => fixture.matchNumber ?? 0)) + 1
    const matchFormat = config.matchType === "t20" ? "t20" as const
      : config.matchType === "odi" ? "odi" as const : "custom" as const

    const created: MatchRow[] = []
    let matchNumber = nextNumber
    for (const [teamAId, teamBId] of plan.pairs) {
      const [row] = await tx.insert(matches).values({
        tenantId,
        tournamentId,
        teamAId,
        teamBId,
        matchNumber,
        matchType: plan.matchType,
        matchFormat,
        totalOvers: config.overs,
        status: "scheduled",
        createdBy: context.actor.id,
      }).returning()
      if (!row) throw new Error("Could not save the advanced stage fixture")
      created.push(row)
      matchNumber += 1
    }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: context.actor.id, actorRole: context.member.role,
      method: "TOURNAMENT_ADVANCE", path: `/dashboard/tournaments/${tournamentId}`,
      statusCode: "200",
      payload: { resourceId: tournamentId, before: { status: tournament.status },
        after: { status: tournament.status },
        changedFields: ["matches"], format: tournament.format, stage: plan.stageLabel,
        created: created.length },
    })

    return { tournament: tournament as Tournament, stage: plan.stageLabel, created }
  }, { isolationLevel: "read committed" })
}
