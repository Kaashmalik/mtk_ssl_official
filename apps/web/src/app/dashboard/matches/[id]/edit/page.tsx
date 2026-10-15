import React from "react"
import { notFound, redirect } from "next/navigation"
import { getMatch, getMatchFormOptions } from "@/app/actions/matches"
import { EditMatchForm } from "@/components/matches/edit-match-form"

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const match = await getMatch(id)
  if (!match) notFound()
  if (match.status !== "scheduled") redirect(`/dashboard/matches/${id}`)

  let teams: { id: string; name: string }[] = []
  try {
    teams = (await getMatchFormOptions("update")).teams
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
