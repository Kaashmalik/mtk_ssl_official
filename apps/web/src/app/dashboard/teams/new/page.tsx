import React from "react"
import { unstable_noStore as noStore } from "next/cache"
import { requireRosterReadContext } from "@/lib/roster-reads"
import { NewTeamForm } from "@/components/teams/new-team-form"

export default async function NewTeamPage() {
  noStore()
  const context = await requireRosterReadContext("team:create")
  if (context.role !== "league_owner") throw new Error("Forbidden")
  return <NewTeamForm />
}
