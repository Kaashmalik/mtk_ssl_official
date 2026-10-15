import { db, playerIds, players, teams, tenants } from "@mtk/database"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { isUniqueViolation } from "./db-errors"

/**
 * League ID-card reads/writes. Every function is predicated on an explicit,
 * caller-resolved `tenantId` — the same active-league scoping contract as the
 * other lib readers/writers (fan-follows, venue-reads, league-settings-reads).
 */

export type PlayerIdCard = typeof playerIds.$inferSelect

export interface IssuedPlayerIdCard {
  id: string
  formattedId: string
  issueDate: Date
  expiryDate: Date | null
  isValid: boolean
  playerId: string
  playerName: string
  jerseyNumber: number | null
  photoUrl: string | null
  teamId: string | null
  teamName: string | null
}

/** Hard bound on the ID-card list read. */
export const playerIdListLimit = 200

/** League code used as the ID prefix, e.g. "SSL" or the tenant slug uppercased. */
export function idPrefix(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5)
  return cleaned || "SSL"
}

/** Existing ID card row for a player within a tenant, if one has been issued. */
export async function findExistingPlayerIdCard(playerId: string, tenantId: string) {
  const [existing] = await db.select().from(playerIds)
    .where(and(eq(playerIds.playerId, playerId), eq(playerIds.tenantId, tenantId)))
    .limit(1)
  return existing ?? null
}

/** The player must exist in the exact league; a foreign id is rejected before the sequence. */
export async function requirePlayerInLeague(playerId: string, tenantId: string): Promise<void> {
  const [player] = await db.select({ id: players.id }).from(players)
    .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)))
    .limit(1)
  if (!player) throw new Error("Player not found")
}

export async function getLeagueSlug(tenantId: string): Promise<string> {
  const [league] = await db.select({ slug: tenants.slug }).from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!league) throw new Error("League not found")
  return league.slug
}

/**
 * Sequence allocation and the insert must be one transaction, holding an
 * advisory lock for this tenant+year, so concurrent issuances serialize and the
 * max(sequence)+1 read cannot race itself.
 */
async function allocatePlayerIdCard(input: {
  tenantId: string
  playerId: string
  prefix: string
  year: number
}): Promise<PlayerIdCard> {
  const { tenantId, playerId, prefix, year } = input
  const [row] = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${year}`}, 0))`,
    )

    const [{ nextSeq }] = await tx.execute(sql`
      SELECT coalesce(max(sequence_number), 0) + 1 AS "nextSeq"
      FROM player_ids
      WHERE tenant_id = ${tenantId} AND year = ${year}
    `)

    const sequenceNumber = Number(nextSeq ?? 1)
    return tx.insert(playerIds).values({
      tenantId,
      playerId,
      prefix,
      year,
      sequenceNumber,
      formattedId: `${prefix}-${year}-${String(sequenceNumber).padStart(4, "0")}`,
    }).returning()
  })
  return row
}

/**
 * Issue (or return) the league ID card for a player inside the exact league.
 * Benign races after the advisory lock — a concurrent issuance of the same
 * player (`UNIQUE (player_id, tenant_id)`) or a claimed sequence — return the
 * row that actually won instead of surfacing a spurious failure.
 */
export async function issuePlayerIdCard(input: {
  tenantId: string
  playerId: string
}): Promise<{ action: "existing" | "created" | "raced"; card: PlayerIdCard }> {
  const { tenantId, playerId } = input
  await requirePlayerInLeague(playerId, tenantId)
  const prefix = idPrefix(await getLeagueSlug(tenantId))
  const year = new Date().getUTCFullYear()

  const existing = await findExistingPlayerIdCard(playerId, tenantId)
  if (existing) return { action: "existing", card: existing }

  try {
    const card = await allocatePlayerIdCard({ tenantId, playerId, prefix, year })
    return { action: "created", card }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findExistingPlayerIdCard(playerId, tenantId)
      if (winner) return { action: "raced", card: winner }
    }
    throw err
  }
}

/** Revoke within the exact league; false when the player has no card there. */
export async function revokePlayerIdCard(playerId: string, tenantId: string): Promise<boolean> {
  const updated = await db.update(playerIds).set({ isValid: false })
    .where(and(eq(playerIds.playerId, playerId), eq(playerIds.tenantId, tenantId)))
    .returning({ id: playerIds.id })
  return updated.length > 0
}

export async function setPlayerIdCardExpiry(
  playerId: string,
  tenantId: string,
  expiryDate: Date | null,
): Promise<boolean> {
  const updated = await db.update(playerIds)
    .set({ expiryDate })
    .where(and(eq(playerIds.playerId, playerId), eq(playerIds.tenantId, tenantId)))
    .returning({ id: playerIds.id })
  return updated.length > 0
}

/**
 * All issued ID cards for the tenant, with player + team names resolved. The
 * join and the team-name lookup are both predicated on the same tenant, so a
 * foreign-league player or team can never leak into the list.
 */
export async function listIssuedPlayerIdCards(tenantId: string): Promise<IssuedPlayerIdCard[]> {
  const rows = await db.select({
    id: playerIds.id,
    formattedId: playerIds.formattedId,
    issueDate: playerIds.issueDate,
    expiryDate: playerIds.expiryDate,
    isValid: playerIds.isValid,
    playerId: playerIds.playerId,
    playerName: players.name,
    jerseyNumber: players.jerseyNumber,
    photoUrl: players.photoUrl,
    teamId: players.teamId,
  })
    .from(playerIds)
    .innerJoin(players, eq(playerIds.playerId, players.id))
    .where(and(eq(playerIds.tenantId, tenantId), eq(players.tenantId, tenantId)))
    .orderBy(desc(playerIds.createdAt))
    .limit(playerIdListLimit)

  const teamIds = Array.from(new Set(rows.map((r) => r.teamId).filter((x): x is string => !!x)))
  const teamRows = teamIds.length
    ? await db.select({ id: teams.id, name: teams.name }).from(teams)
        .where(and(
          inArray(teams.id, teamIds),
          eq(teams.tenantId, tenantId),
        ))
    : []
  const teamById = new Map(teamRows.map((t) => [t.id, t.name]))

  return rows.map((r) => ({ ...r, teamName: r.teamId ? teamById.get(r.teamId) ?? null : null }))
}
