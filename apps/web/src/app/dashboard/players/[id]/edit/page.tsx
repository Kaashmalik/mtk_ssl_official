import { notFound, redirect } from "next/navigation"
import { getPlayer } from "@/app/actions/players"
import { getTeams } from "@/app/actions/teams"
import { EditPlayerForm } from "@/components/players/edit-player-form"

export default async function EditPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const player = await getPlayer(id)
  if (!player) notFound()

  let teams: { id: string; name: string }[] = []
  try {
    const result = await getTeams({
      page: 1,
      pageSize: 100,
      isActive: true,
      sortBy: "name",
      sortOrder: "asc",
    })
    teams = result.data.map((t) => ({ id: t.id, name: t.name }))
  } catch {
    redirect("/dashboard/league/setup")
  }

  return <EditPlayerForm player={player} teams={teams} />
}
