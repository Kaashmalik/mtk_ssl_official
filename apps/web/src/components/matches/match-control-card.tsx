"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Ban, CalendarClock, CalendarPlus } from "lucide-react"
import { forfeitMatchAction, postponeMatchAction, rescheduleMatchAction } from "@/app/actions/competition-control"

/**
 * COMP-07 (Batch 153): owner-only match controls. Forfeit and postpone
 * REQUIRE a named reason; reschedule takes a new date and clears a
 * postponement. The client only sizes the buttons - every authority and
 * state-machine rule is re-verified by the writer under a lock, so a
 * stale page can never perform a move that is no longer legal.
 */

const OPEN_FOR_CONTROL = ["scheduled", "toss", "live", "innings_break"]
const OPEN_FOR_RESCHEDULE = ["scheduled", "postponed"]

export function MatchControlCard({ matchId, matchStatus }: { matchId: string; matchStatus: string | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forfeitReason, setForfeitReason] = useState("")
  const [postponeReason, setPostponeReason] = useState("")
  const [newDate, setNewDate] = useState("")

  const status = matchStatus ?? "scheduled"
  const canControl = OPEN_FOR_CONTROL.includes(status)
  const canReschedule = OPEN_FOR_RESCHEDULE.includes(status)

  const run = (fn: () => Promise<string>) => {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        const done = await fn()
        setMessage(done)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "The move was refused - refresh and check the match state")
      }
    })
  }

  return (
    <Card className="border-none shadow-lg bg-card/50 backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-lg">Competition controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Owner-only moves, audited. A forfeited or postponed match keeps its
          record; a rescheduled match returns to the fixtures list. Matches
          with a recorded result can never be rewritten here.
        </p>

        {canControl && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" />Forfeit (reason required)</label>
              <Input value={forfeitReason} maxLength={500} placeholder="e.g. Team failed to appear" onChange={(e) => setForfeitReason(e.target.value)} />
              <Button
                size="sm"
                variant="destructive"
                disabled={pending || !forfeitReason.trim()}
                onClick={() => run(async () => {
                  const r = await forfeitMatchAction({ matchId, reason: controlReasonTrim(forfeitReason) })
                  setForfeitReason("")
                  return r.changed ? "Match forfeited. The decision is recorded in the audit log." : "Match was already forfeited."
                })}
              >Forfeit match</Button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Postpone (reason required)</label>
              <Input value={postponeReason} maxLength={500} placeholder="e.g. ground double-booked" onChange={(e) => setPostponeReason(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !postponeReason.trim()}
                onClick={() => run(async () => {
                  const r = await postponeMatchAction({ matchId, reason: controlReasonTrim(postponeReason) })
                  setPostponeReason("")
                  return r.changed ? "Match postponed. Set a new date to return it to fixtures." : "Match was already postponed."
                })}
              >Postpone match</Button>
            </div>
          </div>
        )}

        {canReschedule && (
          <div className="space-y-2">
            <label className="text-xs font-medium flex items-center gap-1.5"><CalendarPlus className="h-3.5 w-3.5" />Reschedule{status === "postponed" ? " (clears the postponement)" : ""}</label>
            <Input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !newDate}
              onClick={() => run(async () => {
                const r = await rescheduleMatchAction({ matchId, newDate: new Date(newDate).toISOString() })
                setNewDate("")
                return r.changed ? "Match rescheduled." : "No change was needed."
              })}
            >Set new date</Button>
          </div>
        )}

        {!canControl && !canReschedule && (
          <p className="text-xs text-muted-foreground">
            This match is {status}. Recorded results and closed fixtures have no
            competition controls here; corrections use the audited correction
            request path.
          </p>
        )}

        {pending && <p className="text-xs text-muted-foreground">Working…</p>}
        {message && <p className="text-xs text-success" role="status">{message}</p>}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  )
}

function controlReasonTrim(value: string): string {
  return value.trim().slice(0, 500)
}
