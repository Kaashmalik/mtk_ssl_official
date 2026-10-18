"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { decideTournamentApplicationAction, submitTournamentApplicationAction, withdrawTournamentApplicationAction } from "@/app/actions/tournament-applications"
import { describeApplicationStatus } from "@mtk/database/lib/tournament-application-policy"

/**
 * REG-03 (Batch 147): the tournament-application card. Owner view: the
 * bounded application list with the four fixed-vocabulary decisions -
 * every button resolves through the writer's state machine, so the card
 * only reflects resulting state. Manager view (same card, second facet):
 * apply / withdraw, with the pure describe sentence as the status line.
 * Errors are shown, never swallowed; controls are disabled in flight.
 */
export interface ApplicationRow {
  id: string
  teamName: string
  status: string
  createdAt: string
}

export function TournamentApplicationCard({
  tournamentId,
  isOwner,
  rows,
  managerFacet,
}: {
  tournamentId: string
  isOwner: boolean
  rows: ApplicationRow[]
  managerFacet: { teamId: string; live: { id: string; status: string } | null } | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const run = (task: () => Promise<string>) => {
    setError(null)
    startTransition(async () => {
      try {
        setDone(await task())
      } catch (err) {
        setError(err instanceof Error ? err.message : "The application change could not be recorded")
      }
    })
  }

  const decide = (applicationId: string, decision: string) =>
    run(async () => {
      const result = await decideTournamentApplicationAction({ applicationId, decision })
      return `Decision recorded: ${result.status}`
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Tournament applications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isOwner ? (
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="font-medium">{row.teamName}</span>
                  <span className="text-xs text-muted-foreground">{describeApplicationStatus(row.status as never)}</span>
                  {["submitted", "needs_information", "waitlisted"].includes(row.status) && (
                    <span className="ml-auto flex gap-1">
                      <button type="button" disabled={pending} onClick={() => decide(row.id, "approve")}
                        className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50">Approve</button>
                      <button type="button" disabled={pending} onClick={() => decide(row.id, "request_information")}
                        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50">Ask for information</button>
                      <button type="button" disabled={pending} onClick={() => decide(row.id, "waitlist")}
                        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50">Waitlist</button>
                      <button type="button" disabled={pending} onClick={() => decide(row.id, "decline")}
                        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50">Decline</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
        {managerFacet && !isOwner ? (
          managerFacet.live ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{describeApplicationStatus(managerFacet.live.status as never)}</p>
              <button type="button" disabled={pending} onClick={() => run(async () => {
                await withdrawTournamentApplicationAction({ applicationId: managerFacet.live!.id })
                return "Application withdrawn"
              })} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50">Withdraw application</button>
            </div>
          ) : (
            <button type="button" disabled={pending} onClick={() => run(async () => {
              await submitTournamentApplicationAction({ tournamentId, teamId: managerFacet.teamId })
              return "Application submitted"
            })} className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50">Apply for this tournament</button>
          )
        ) : null}
        {done && <p role="status" className="text-xs text-green-700">{done}</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  )
}
