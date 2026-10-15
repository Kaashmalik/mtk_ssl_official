import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { NewTournamentForm } from "@/components/tournaments/new-tournament-form"

export default async function NewTournamentPage() {
  const { userId } = await auth()
  if (!userId) redirect("/")

  // Exact active league + tournament:create before rendering the creator. The
  // create action resolves the same league server-side, so no tenant is passed.
  await requireActiveLeagueContext("tournament:create")

  return <NewTournamentForm />
}
