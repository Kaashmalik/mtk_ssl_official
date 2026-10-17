import { randomUUID } from "crypto"
import { db, tournamentAwards, tournaments, players, teams, leagueRegistrations, auditLogs } from "@mtk/database"
import { AWARD_CATEGORIES, AWARD_CATEGORY_LABELS, isAwardVisible, type AwardCategory } from "@mtk/database/lib/award-policy"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { dispatchNotificationToTournamentFollowers } from "@/lib/notification-dispatch"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
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
  // Captured inside the transaction (step 1) for the post-commit notification.
  let declaredTournamentName = ""

  const result = await db.transaction(async (tx) => {
    // (1) The tournament must exist in the SAME league.
    const [tournament] = await tx
      .select({ id: tournaments.id, name: tournaments.name })
      .from(tournaments)
      .where(and(eq(tournaments.id, parsed.tournamentId), eq(tournaments.tenantId, context.tenantId)))
      .limit(1)
    if (!tournament) throw new Error("Forbidden: tournament not found in this league")
    declaredTournamentName = tournament.name

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

  // FAN-02: followers of the tournament learn about a new/corrected award.
  // A replay (`changed: false`) dispatches nothing, so re-runs are durable. The
  // fan-out itself is consented (per-member policy), deduplicated (award id)
  // and fire-and-forget: a delivery problem NEVER fails the declaration, which
  // is the official record; notification delivery is an ancillary courtesy.
  if (result.changed && declaredTournamentName) {
    try {
      await dispatchNotificationToTournamentFollowers({
        tenantId: context.tenantId,
        tournamentId: parsed.tournamentId,
        type: "award_declared",
        title: "Award declared for a tournament you follow",
        body: `${declaredTournamentName}: ${AWARD_CATEGORY_LABELS[result.category]} was declared.`,
        dedupKey: `award:${result.awardId}`,
      })
    } catch {
      // Ancillary by design; the official record and its audit already exist.
    }
  }

  return result
}

/** Bounded picker snapshot size (house bound; overflow is disclosed, not hidden). */
export const AWARD_MANAGER_BOUND = 200

export type AwardCandidateTeam = { id: string; name: string }
export type AwardCandidatePlayer = { id: string; name: string; teamId: string | null }
export type ActiveAwardSummary = {
  id: string
  category: AwardCategory
  holderName: string | null
  citation: string | null
}
export type AwardDeclarationContext = {
  teams: AwardCandidateTeam[]
  players: AwardCandidatePlayer[]
  teamsComplete: boolean
  playersComplete: boolean
  activeAwards: ActiveAwardSummary[]
}

/**
 * Bounded read of everything the organizer's award-declaration UI offers as a
 * winner: teams actually registered in the tournament (approved registrations
 * + legacy tournament teams — the same eligibility set the writer enforces),
 * that tournament's players, and the CURRENT active awards so the form can
 * disclose that a new declaration supersedes the existing holder. Overflow is
 * disclosed through `teamsComplete`/`playersComplete`, never silently
 * truncated. The caller resolves authority (`canEdit`); the write re-checks it.
 */
export async function readAwardDeclarationContext(
  tenantId: string,
  tournamentId: string,
): Promise<AwardDeclarationContext> {
  // (1) Approved registrations of the tournament.
  const registrationRows = await db
    .select({ teamId: leagueRegistrations.teamId })
    .from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, tournamentId),
      eq(leagueRegistrations.tenantId, tenantId),
      eq(leagueRegistrations.status, "approved"),
    ))
  const teamIdSet = new Set<string>(registrationRows.map((row) => row.teamId))

  // (2) Legacy tournament teams (already carry names).
  const legacyRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tournamentId, tournamentId), eq(teams.tenantId, tenantId)))
    .orderBy(asc(teams.name))
  const legacyNameById = new Map(legacyRows.map((row) => [row.id, row.name]))
  for (const row of legacyRows) teamIdSet.add(row.id)

  const allTeamIds = Array.from(teamIdSet)
  const teamsComplete = allTeamIds.length <= AWARD_MANAGER_BOUND
  const boundedTeamIds = allTeamIds.slice(0, AWARD_MANAGER_BOUND)

  // (3, 4) Names for registered teams + their player rosters (bounded).
  const nameById = new Map<string, string>()
  let playerRows: { id: string; name: string; teamId: string | null }[] = []
  if (boundedTeamIds.length > 0) {
    const nameRows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, boundedTeamIds)))
    for (const row of nameRows) nameById.set(row.id, row.name)

    playerRows = await db
      .select({ id: players.id, name: players.name, teamId: players.teamId })
      .from(players)
      .where(and(eq(players.tenantId, tenantId), inArray(players.teamId, boundedTeamIds)))
      .orderBy(asc(players.name))
      .limit(AWARD_MANAGER_BOUND + 1)
  }
  const playersComplete = playerRows.length <= AWARD_MANAGER_BOUND

  // (5) Current active awards with resolved holder names. The visibility
  // policy re-runs in memory; `true` is the winner-resolution part only
  // (publication is irrelevant for this authority-side read).
  const awardRows = await db
    .select({
      id: tournamentAwards.id,
      category: tournamentAwards.category,
      playerId: tournamentAwards.playerId,
      playerName: players.name,
      teamId: tournamentAwards.teamId,
      teamName: teams.name,
      citation: tournamentAwards.citation,
    })
    .from(tournamentAwards)
    .leftJoin(players, eq(players.id, tournamentAwards.playerId))
    .leftJoin(teams, eq(teams.id, tournamentAwards.teamId))
    .where(and(
      eq(tournamentAwards.tenantId, tenantId),
      eq(tournamentAwards.tournamentId, tournamentId),
      isNull(tournamentAwards.supersededAt),
    ))
    .orderBy(asc(tournamentAwards.category))

  const teamCandidates: AwardCandidateTeam[] = boundedTeamIds
    .map((id) => ({ id, name: nameById.get(id) ?? legacyNameById.get(id) ?? "Team record unavailable" }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    teams: teamCandidates,
    players: playerRows
      .slice(0, AWARD_MANAGER_BOUND)
      .map((row) => ({ id: row.id, name: row.name, teamId: row.teamId })),
    teamsComplete,
    playersComplete,
    activeAwards: awardRows
      .filter((row) => isAwardVisible(row, true))
      .map((row) => ({
        id: row.id,
        category: row.category,
        holderName: row.playerName ?? row.teamName ?? null,
        citation: row.citation,
      })),
  }
}
