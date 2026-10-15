import React from "react"
import { unstable_noStore as noStore } from "next/cache"
import { requireRosterReadContext, readRosterTeamOptions } from "@/lib/roster-reads"
import { NewPlayerForm } from "@/components/players/new-player-form"

export default async function NewPlayerPage() {
  noStore()
  const context = await requireRosterReadContext("player:create")
  if (context.role !== "league_owner") throw new Error("Forbidden")
  const { teams, truncated } = await readRosterTeamOptions(context.tenantId)
  return <div className="space-y-4">
    {truncated && <p role="status">Showing the first 100 active teams. You can create an unassigned player and manage their roster separately.</p>}
    <NewPlayerForm teams={teams} />
  </div>
}
