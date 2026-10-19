"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import {
  decideTournamentApplicationAction,
  readApplicationRepliesAction,
  replyToTournamentApplicationAction,
  submitTournamentApplicationAction,
  withdrawTournamentApplicationAction,
} from "@/app/actions/tournament-applications"
import { describeApplicationStatus } from "@mtk/database/lib/tournament-application-policy"

/**
 * REG-03 (Batch 147/164): the tournament-application card. Owner view: the
 * bounded application list with the four fixed-vocabulary decisions - every
 * button resolves through the writer's state machine, so the card only
 * reflects resulting state. Manager view (same card, second facet): apply /
 * withdraw, with the pure describe sentence as the status line. Batch 164
 * adds the threaded conversation: participant-gated, server-derived sides,
 * locked when the application resolves. Errors are shown, never swallowed.
 */
export interface ApplicationRow {
  id: string
  teamName: string
  status: string
  createdAt: string
}

type ThreadRows = Awaited<ReturnType<typeof readApplicationRepliesAction>>

const LIVE = ["submitted", "needs_information", "waitlisted"]

/** Thread facet shared by owner and manager (the authority is re-verified
 * server-side on every read and every reply - the UI never decides). */
function ApplicationThread({ applicationId, live }: { applicationId: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  const [replies, setReplies] = useState<ThreadRows | null>(null)
  const [body, setBody] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = () =>
    startTransition(async () => {
      setError(null)
      try {
        setReplies(await readApplicationRepliesAction({ applicationId }))
        setOpen(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "The conversation could not be opened")
      }
    })

  const send = () =>
    startTransition(async () => {
      setError(null)
      try {
        await replyToTournamentApplicationAction({ applicationId, body })
        setBody("")
        setDone("Message sent.")
        setReplies(await readApplicationRepliesAction({ applicationId }))
      } catch (err) {
        setError(err instanceof Error ? err.message : "The message could not be sent")
      }
    })

  return (
    <div className="w-full space-y-2 pt-2">
      {!open ? (
        <button type="button" onClick={load} disabled={pending}
          className="rounded-md border px-2 py-1 text-xs disabled:opacity-50">
          Conversation
        </button>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2" data-testid="application-thread">
          {(replies ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No messages yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(replies ?? []).map((r) => (
                <li key={r.id} className="rounded border p-1.5">
                  <span className="text-xs font-semibold">{r.authorSide === "owner" ? "League owner" : "Team manager"}</span>
                  <span className="ml-2">{r.body}</span>
                </li>
              ))}
            </ul>
          )}
          {live ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2100}
                placeholder="Write a message (max 2000 characters)"
                className="flex-1 rounded-md border px-2 py-1 text-sm"
              />
              <button type="button" onClick={send} disabled={pending || body.trim().length === 0}
                className="rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50">
                Send
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">This application has been resolved, so its conversation is locked.</p>
          )}
        </div>
      )}
      {done && <p role="status" className="text-xs text-green-700">{done}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  )
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
                  {LIVE.includes(row.status) && (
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
                  <ApplicationThread applicationId={row.id} live={LIVE.includes(row.status)} />
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
              <ApplicationThread applicationId={managerFacet.live.id} live={LIVE.includes(managerFacet.live.status)} />
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
