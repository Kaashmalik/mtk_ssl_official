import React from "react"
import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { db, playerIds, players, teams, tenants } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { PlayerIdCard } from "@/components/players/player-id-card"
import { unstable_noStore as noStore } from "next/cache"
import { requireRosterReadContext } from "@/lib/roster-reads"

export const metadata = { title: "Player ID Card" }

export default async function PlayerIdCardPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const { id } = await params
  const context = await requireRosterReadContext("player:read")
  const tenant = context.tenantId

  // Tenant-scoped: an ID card is only viewable by the league that issued it.
  const [row] = await db.select({
    id: playerIds.id,
    formattedId: playerIds.formattedId,
    issueDate: playerIds.issueDate,
    expiryDate: playerIds.expiryDate,
    isValid: playerIds.isValid,
    playerId: playerIds.playerId,
    playerName: players.name,
    teamId: players.teamId,
    jerseyNumber: players.jerseyNumber,
    photoUrl: players.photoUrl,
    role: players.role,
    city: players.city,
  })
    .from(playerIds)
    .innerJoin(players, and(eq(playerIds.playerId, players.id), eq(players.tenantId, tenant)))
    .where(and(eq(playerIds.id, id), eq(playerIds.tenantId, tenant)))
    .limit(1)

  if (!row) notFound()
  const record = row

  let teamName: string | null = null
  if (row.teamId) {
    const [t] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, row.teamId), eq(teams.tenantId, tenant))).limit(1)
    teamName = t?.name ?? null
  }

  const [league] = await db.select({ name: tenants.name, slug: tenants.slug })
    .from(tenants).where(eq(tenants.id, tenant)).limit(1)

  return (
    <PlayerIdCard
      data={{
        formattedId: record.formattedId,
        playerName: record.playerName,
        teamName,
        jerseyNumber: record.jerseyNumber,
        photoUrl: record.photoUrl,
        role: record.role,
        city: record.city,
        issueDate: record.issueDate,
        expiryDate: record.expiryDate,
        isValid: record.isValid,
        tenantName: league?.name ?? "League",
        tenantSlug: league?.slug ?? "",
      }}
    />
  )
}