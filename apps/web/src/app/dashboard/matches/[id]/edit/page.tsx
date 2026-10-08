import { notFound, redirect } from "next/navigation"
import { getMatch } from "@/app/actions/matches"
import { getTeams } from "@/app/actions/teams"
import { EditMatchForm } from "@/components/matches/edit-match-form"

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const match = await getMatch(id)
  if (!match) notFound()

  let teams: { id: string; name: string }[] = []
  try {
    const result = await getTeams({ page: 1, pageSize: 100, isActive: true, sortBy: "name", sortOrder: "asc" })
    teams = result.data.map((t) => ({ id: t.id, name: t.name }))
  } catch {
    // Redirect if unauthorized or tenant missing
    redirect("/dashboard/league/setup")
  }

  return (
    <EditMatchForm
      match={{
        ...match,
        matchFormat: match.matchFormat || "t20",
        matchType: match.matchType || "group",
        totalOvers: match.totalOvers ?? 20,
      }}
      teams={teams}
    />
  )
}
