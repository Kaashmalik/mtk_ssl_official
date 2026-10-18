import React from "react"
import { notFound, redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { requireRosterReadContext, readEditableRosterPlayer, readRosterTeamOptions, readRosterTeam } from "@/lib/roster-reads"
import { EditPlayerForm } from "@/components/players/edit-player-form"
import { GuardianConsentCard } from "@/components/players/guardian-consent-card"

export default async function EditPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  noStore()
  const context = await requireRosterReadContext("player:update")
  const { id } = await params
  const player = await readEditableRosterPlayer(context, id)
  if (!player) notFound()
  if (!player.isActive) redirect(`/dashboard/players/${id}`)
  const currentTeam = player.teamId ? await readRosterTeam(context.tenantId, player.teamId) : null
  if (player.teamId && (!currentTeam || !currentTeam.isActive)) redirect(`/dashboard/players/${id}`)
  const { teams, truncated } = await readRosterTeamOptions(context.tenantId)
  if (currentTeam && !teams.some(team => team.id === currentTeam.id)) teams.push({ id: currentTeam.id, name: currentTeam.name })
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">To move a player between teams, remove them from their current roster first.</p>
    {truncated && <p role="status">Showing the first 100 active teams plus the current team.</p>}
    <EditPlayerForm player={player} teams={teams} />
    <GuardianConsentCard
      playerId={player.id}
      dateOfBirth={player.dateOfBirth ?? null}
      guardianName={player.guardianName ?? null}
      guardianConsentAt={player.guardianConsentAt ?? null}
      isOwner={context.role === "league_owner"}
    />
  </div>
}
