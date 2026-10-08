import { notFound } from "next/navigation"
import { getTeam } from "@/app/actions/teams"
import { EditTeamForm } from "@/components/teams/edit-team-form"

/**
 * Edit an existing team. Server component — loads the team (tenant-scoped via
 * the action) and seeds the client form. If the team doesn't exist or belongs
 * to another tenant, getTeam() returns null → 404.
 */
export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const team = await getTeam(id)
  if (!team) notFound()

  return <EditTeamForm team={team} />
}
