import React, { Suspense } from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { RegisterTeamForm } from "@/components/registrations/register-team-form"
import { requireRegistrationReadContext, readRegistrationFormOptions } from "@/lib/registration-reads"

/**
 * Self-service team registration. The pickers are read through the exact active league
 * (registration:create), and a read or authorization failure propagates to the error
 * boundary instead of silently redirecting to league setup or rendering empty pickers.
 */
export default async function NewRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ tournamentId?: string }>
}) {
  const params = await searchParams

  const { userId } = await auth()
  if (!userId) redirect("/")

  const context = await requireRegistrationReadContext("registration:create")
  const { teams, tournaments, players } = await readRegistrationFormOptions(context.tenantId)

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
