import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { db, playerIds, players, teams, tenants } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"
import { PlayerIdCard } from "@/components/players/player-id-card"
import { unstable_noStore as noStore } from "next/cache"

export const metadata = { title: "Player ID Card" }

export default async function PlayerIdCardPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const { id } = await params
  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  // Tenant-scoped: an ID card is only viewable by the league that issued it.
  const [row] = await db.select()
    .from(playerIds)
    .innerJoin(players, eq(playerIds.playerId, players.id))
    .where(and(eq(playerIds.id, id), eq(playerIds.tenantId, tenant.id)))
    .limit(1)

  if (!row) notFound()
  const record = row.player_ids
  const player = row.players

  let teamName: string | null = null
  if (player.teamId) {
    const [t] = await db.select({ name: teams.name }).from(teams)
      .where(eq(teams.id, player.teamId)).limit(1)
    teamName = t?.name ?? null
  }

  const [league] = await db.select({ name: tenants.name, slug: tenants.slug })
    .from(tenants).where(eq(tenants.id, tenant.id)).limit(1)

  return (
    <PlayerIdCard
      data={{
        formattedId: record.formattedId,
        playerName: player.name,
        teamName,
        jerseyNumber: player.jerseyNumber ?? null,
        photoUrl: player.photoUrl ?? null,
        role: player.role ?? null,
        city: player.city ?? null,
        issueDate: record.issueDate,
        expiryDate: record.expiryDate,
        isValid: record.isValid,
        tenantName: league?.name ?? tenant.name,
        tenantSlug: league?.slug ?? tenant.slug,
      }}
    />
  )
}