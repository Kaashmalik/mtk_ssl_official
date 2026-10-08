import { notFound } from "next/navigation"
import { getTournament } from "@/app/actions/tournaments"
import { EditTournamentForm } from "@/components/tournaments/edit-tournament-form"

/**
 * Edit an existing tournament. Server component — loads the tournament
 * (tenant-scoped via the action) and seeds the client form.
 */
export default async function EditTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tournament = await getTournament(id)
  if (!tournament) notFound()

  return <EditTournamentForm tournament={tournament} />
}
