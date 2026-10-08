import { redirect } from "next/navigation"
import { getTeams } from "@/app/actions/teams"
import { NewPlayerForm } from "@/components/players/new-player-form"

export default async function NewPlayerPage() {
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

  return <NewPlayerForm teams={teams} />
}
