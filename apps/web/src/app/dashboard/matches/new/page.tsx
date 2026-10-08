import { redirect } from "next/navigation"
import { getTeams } from "@/app/actions/teams"
import { getTournaments } from "@/app/actions/tournaments"
import { NewMatchForm } from "@/components/matches/new-match-form"

export default async function NewMatchPage() {
  let teams: { id: string; name: string }[] = []
  let tournaments: { id: string; name: string }[] = []
  try {
    const [teamsResult, tournamentsResult] = await Promise.all([
      getTeams({ page: 1, pageSize: 100, isActive: true, sortBy: "name", sortOrder: "asc" }),
      getTournaments({ page: 1, pageSize: 100, sortBy: "name", sortOrder: "asc" }),
    ])
    teams = teamsResult.data.map((t) => ({ id: t.id, name: t.name }))
    const tournamentRows = tournamentsResult.data as Array<{ id: string; name: string }>
    tournaments = tournamentRows.map((t) => ({ id: t.id, name: t.name }))
  } catch {
    redirect("/dashboard/league/setup")
  }

  return <NewMatchForm teams={teams} tournaments={tournaments} />
}
