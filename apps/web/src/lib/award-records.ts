import { randomUUID } from "crypto"
import { db, tournamentAwards, tournaments, players, teams, leagueRegistrations, auditLogs } from "@mtk/database"
import { AWARD_CATEGORIES, type AwardCategory } from "@mtk/database/lib/award-policy"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"

/**
 * PUB-04 official award declarations (first slice).
 *
 * Authority: `tournament:update` in the exact active league — identity,
 * membership and permission are re-derived server-side by
 * `requireActiveLeagueContext` and never taken from a client argument.
 * Corrections SUPERSede the active row instead of mutating it (also the
 * matching-revision/hub-listing house style): the prior decision stays
 * auditable history, the DB CHECK guarantees one winner per row, and the
 * partial unique index makes "at most one active award per (tournament,
 * category)" a database guarantee, not a race the writer wins by luck.
 *
 * Officialness is enforced at write time: the winner's team must actually be
 * registered in the tournament (approved registrations or legacy tournament
 * teams), so e.g. a best-batsman award cannot drift onto an unrelated player.
 * A player without a resolvable team fails closed — unverifiable membership
 * never becomes an official record. No fan-vote input is accepted anywhere.
 */

export const declareAwardInputSchema = z.object({
  tournamentId: z.string().uuid(),
  category: z.enum(AWARD_CATEGORIES),
  playerId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  citation: z.string().max(500).nullish(),
}).strict().refine(
  (value) => (value.playerId != null) !== (value.teamId != null),
  { message: "An award needs exactly one winner: a player or a team, never both or neither" },
)

export type DeclareAwardInput = z.infer<typeof declareAwardInputSchema>

export type DeclareAwardResult = {
  tournamentId: string
  category: AwardCategory
  /** False when the decision matched the active row exactly (replay safety). */
  changed: boolean
  awardId: string | null
  /** The active row this declaration superseded, when correcting. */
  supersededId: string | null
}

export async function declareTournamentAward(input: unknown): Promise<DeclareAwardResult> {
  const parsed = declareAwardInputSchema.parse(input)
  const citation = parsed.citation?.trim() || null
  const context = await requireActiveLeagueContext("tournament:update")

  return db.transaction(async (tx) => {
    // (1) The tournament must exist in the SAME league.
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")

    // (2, 3) Registered winner-eligibility set: approved registrations + legacy teams.
    const registrationRows = await tx
      .select({ teamId: leagueRegistrations.teamId })
      .from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tournamentId, parsed.tournamentId),
        eq(leagueRegistrations.tenantId, context.tenantId),
        eq(leagueRegistrations.status, "approved"),
      ))
    const legacyRows = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tournamentId, parsed.tournamentId), eq(teams.tenantId, context.tenantId)))
    const registeredTeamIds = new Set<string>([
      ...registrationRows.map((row) => row.teamId),
      ...legacyRows.map((row) => row.id),
    ])

    // (4, 5) Winner resolution, tenant-pinned; a player must carry a registered team.
    let winnerTeamId: string | null = null
    if (parsed.playerId != null) {
      const [player] = await tx
        .select({ teamId: players.teamId })
        .from(players)
        .where(and(eq(players.id, parsed.playerId), eq(players.tenantId, context.tenantId)))
        .limit(1)
      if (!player) throw new Error("Forbidden: player not found in this league")
      winnerTeamId = player.teamId
      if (!winnerTeamId || !registeredTeamIds.has(winnerTeamId)) {
        throw new Error("Forbidden: the awarded player's team is not registered in this tournament")
      }
    } else if (parsed.teamId != null) {
      if (!registeredTeamIds.has(parsed.teamId)) {
        throw new Error("Forbidden: the awarded team is not registered in this tournament")
      }
      winnerTeamId = parsed.teamId
    }

    // (6) Serialize corrections against the active row; the DB partial unique
    // index is the real guarantee, the lock just avoids a noisy rollback.
    const [active] = await tx
      .select({
        id: tournamentAwards.id,
        playerId: tournamentAwards.playerId,
        teamId: tournamentAwards.teamId,
        citation: tournamentAwards.citation,
      })
      .from(tournamentAwards)
      .where(and(
        eq(tournamentAwards.tournamentId, parsed.tournamentId),
        eq(tournamentAwards.category, parsed.category),
        eq(tournamentAwards.tenantId, context.tenantId),
        isNull(tournamentAwards.supersededAt),
      ))
      .for("update")
      .limit(1)

    const unchanged = active != null
      && active.playerId === (parsed.playerId ?? null)
      && active.teamId === (parsed.teamId ?? null)
      && (active.citation ?? null) === citation
    if (unchanged) {
      return { tournamentId: parsed.tournamentId, category: parsed.category, changed: false, awardId: active.id, supersededId: null }
    }

    if (active) {
      await tx.update(tournamentAwards)
        .set({ supersededAt: new Date() })
        .where(eq(tournamentAwards.id, active.id))
    }

    const [inserted] = await tx
      .insert(tournamentAwards)
      .values({
        tenantId: context.tenantId,
        tournamentId: parsed.tournamentId,
        category: parsed.category,
        playerId: parsed.playerId ?? null,
        teamId: parsed.teamId ?? null,
        citation,
        declaredBy: context.actorId,
      })
      .returning({ id: tournamentAwards.id })
    if (!inserted) throw new Error("The award could not be recorded. Please retry.")

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.role,
      method: active ? "AWARD_CORRECTED" : "AWARD_DECLARED",
      path: "/actions/awards",
      statusCode: "200",
      payload: {
        tournamentId: parsed.tournamentId,
        category: parsed.category,
        winner: parsed.playerId != null ? { playerId: parsed.playerId } : { teamId: parsed.teamId },
        citation,
        supersededId: active?.id ?? null,
        awardId: inserted.id,
      },
    })

    return {
      tournamentId: parsed.tournamentId,
      category: parsed.category,
      changed: true,
      awardId: inserted.id,
      supersededId: active?.id ?? null,
    }
  }, { isolationLevel: "read committed" })
}
