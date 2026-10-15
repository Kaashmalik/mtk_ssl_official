import React from "react"
import { notFound, redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { requireRosterReadContext, readRosterTeam, canManageRosterTeam } from "@/lib/roster-reads"
import { EditTeamForm } from "@/components/teams/edit-team-form"

export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  noStore()
  const context = await requireRosterReadContext("team:update")
  const { id } = await params
  const team = await readRosterTeam(context.tenantId, id)
  if (!team) notFound()
  if (!canManageRosterTeam(context, team)) redirect(`/dashboard/teams/${id}`)

  return <EditTeamForm team={team} />
}
