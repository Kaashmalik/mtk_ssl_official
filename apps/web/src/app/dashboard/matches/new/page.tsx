import React from "react"
import { redirect } from "next/navigation"
import { getMatchFormOptions } from "@/app/actions/matches"
import { NewMatchForm } from "@/components/matches/new-match-form"

export default async function NewMatchPage() {
  let teams: { id: string; name: string }[] = []
  let tournaments: { id: string; name: string }[] = []
  try {
    const options = await getMatchFormOptions("create")
    teams = options.teams
    tournaments = options.tournaments
  } catch {
    redirect("/dashboard/league/setup")
  }

  return <NewMatchForm teams={teams} tournaments={tournaments} />
}
