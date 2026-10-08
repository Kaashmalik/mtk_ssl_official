import { Suspense } from "react"
import { redirect } from "next/navigation"
import { getTeams } from "@/app/actions/teams"
import { getTournaments } from "@/app/actions/tournaments"
import { getPlayers } from "@/app/actions/players"
import { RegisterTeamForm } from "@/components/registrations/register-team-form"

export default async function NewRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ tournamentId?: string }>
}) {
  const params = await searchParams

  let teams: { id: string; name: string }[] = []
  let tournaments: { id: string; name: string; registrationOpen: boolean }[] = []
  let players: { id: string; name: string; teamId: string | null }[] = []

  try {
    const [teamsResult, tournamentsResult, playersResult] = await Promise.all([
      getTeams({ page: 1, pageSize: 100, isActive: true, sortBy: "name", sortOrder: "asc" }),
      getTournaments({ page: 1, pageSize: 100, sortBy: "name", sortOrder: "asc" }),
      getPlayers({ page: 1, pageSize: 200, sortBy: "name", sortOrder: "asc" }),
    ])
    teams = teamsResult.data.map((t) => ({ id: t.id, name: t.name }))
    const tournamentRows = tournamentsResult.data as Array<{
      id: string
      name: string
      registrationOpen: boolean
    }>
    tournaments = tournamentRows.map((t) => ({
      id: t.id,
      name: t.name,
      registrationOpen: Boolean(t.registrationOpen),
    }))
    players = playersResult.data.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId ?? null,
    }))
  } catch {
    redirect("/dashboard/league/setup")
  }

  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
      <RegisterTeamForm
        teams={teams}
        tournaments={tournaments}
        players={players}
        defaultTournamentId={params.tournamentId}
      />
    </Suspense>
  )
}
