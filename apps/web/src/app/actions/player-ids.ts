"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, playerIds, players, teams, withTenantContext } from "@mtk/database"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { isUniqueViolation } from "@/lib/db-errors"
import { withAuth } from "./action-guard"

async function requireTenant() {
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")
  return tenant
}

/** League code used as the ID prefix, e.g. "SSL" or the tenant slug uppercased. */
function idPrefix(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5)
  return cleaned || "SSL"
}

/** Existing ID card row for a player within a tenant, if one has been issued. */
async function findExistingId(playerId: string, tenantId: string) {
  const [existing] = await db.select().from(playerIds)
    .where(and(eq(playerIds.playerId, playerId), eq(playerIds.tenantId, tenantId)))
    .limit(1)
  return existing ?? null
}

/** Issues (or returns) the league ID card number for a player. */
export const issuePlayerId = withAuth("player:update", async (playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [player] = await db.select().from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, tenant.id)))
      .limit(1)
    if (!player) throw new Error("Player not found")

    const existing = await findExistingId(playerId, tenant.id)
    if (existing) return { success: true, playerId: existing }

    const year = new Date().getUTCFullYear()
    const prefix = idPrefix(tenant.slug)

    try {
      // Sequence allocation and the insert must be one transaction, and must
      // hold an advisory lock for this tenant+year.
      //
      // Without the lock, two concurrent issuances both read
      // `coalesce(max(sequence_number), 0) + 1`, compute the same value, and
      // the loser fails on the `UNIQUE (formatted_id)` constraint — surfacing
      // to the user as a failed issuance rather than a retry. The advisory lock
      // is transaction-scoped, so it is released on commit or rollback without
      // any explicit unlock, and cannot deadlock against itself.
      const created = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenant.id}:${year}`}, 0))`,
        )

        const [{ nextSeq }] = await tx.execute(sql`
          SELECT coalesce(max(sequence_number), 0) + 1 AS "nextSeq"
          FROM player_ids
          WHERE tenant_id = ${tenant.id} AND year = ${year}
        `)

        const sequenceNumber = Number(nextSeq ?? 1)
        const [row] = await tx.insert(playerIds).values({
          tenantId: tenant.id,
          playerId,
          prefix,
          year,
          sequenceNumber,
          formattedId: `${prefix}-${year}-${String(sequenceNumber).padStart(4, "0")}`,
        }).returning()

        return row
      })

      revalidatePath(`/dashboard/players/${playerId}`)
      return { success: true, playerId: created }
    } catch (err) {
      // Lost a race after all: either the same player was issued concurrently
      // (`UNIQUE (player_id, tenant_id)`) or the sequence was claimed between
      // the lock being released and this insert. Both are benign — return the
      // row that actually won instead of surfacing a spurious failure.
      if (isUniqueViolation(err)) {
        const winner = await findExistingId(playerId, tenant.id)
        if (winner) return { success: true, playerId: winner }
      }
      throw err
    }
  })
})

export const revokePlayerId = withAuth("player:update", async (playerId: string) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    await db.update(playerIds).set({ isValid: false })
      .where(and(eq(playerIds.playerId, playerId), eq(playerIds.tenantId, tenant.id)))
    revalidatePath(`/dashboard/players/${playerId}`)
    return { success: true }
  })
})

/** All issued ID cards for the tenant, with player + team names resolved. */
export const getIssuedPlayerIds = withAuth("player:read", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()

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
    .where(and(eq(playerIds.tenantId, tenant.id), eq(players.tenantId, tenant.id)))
    .orderBy(desc(playerIds.createdAt))
    .limit(200)

  const teamIds = Array.from(new Set(rows.map((r) => r.teamId).filter((x): x is string => !!x)))
  const teamRows = teamIds.length
    ? await db.select({ id: teams.id, name: teams.name }).from(teams)
        .where(and(
          inArray(teams.id, teamIds),
          // Scoped like every other read here. The ids originate from
          // tenant-filtered players, but relying on that instead of filtering
          // means a cross-tenant teamId would leak its name.
          eq(teams.tenantId, tenant.id),
        ))
    : []
  const teamById = new Map(teamRows.map((t) => [t.id, t.name]))

  return rows.map((r) => ({ ...r, teamName: r.teamId ? teamById.get(r.teamId) ?? null : null }))
})

// NOTE: not exported — "use server" files may only export async functions.
const setPlayerIdExpirySchema = z.object({
  playerId: z.string().uuid(),
  expiryDate: z.string().nullable(),
})

export const setPlayerIdExpiry = withAuth("player:update", async (input: z.infer<typeof setPlayerIdExpirySchema>) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await requireTenant()
  const parsed = setPlayerIdExpirySchema.parse(input)

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    await db.update(playerIds)
      .set({ expiryDate: parsed.expiryDate ? new Date(parsed.expiryDate) : null })
      .where(and(eq(playerIds.playerId, parsed.playerId), eq(playerIds.tenantId, tenant.id)))
    revalidatePath(`/dashboard/players/${parsed.playerId}`)
    return { success: true }
  })
})