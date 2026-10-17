"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from "@mtk/ui"
import { ListChecks } from "lucide-react"
import { toast } from "sonner"
import { createPoll, setPollStatus } from "@/app/actions/polls"
import type { TournamentPollSummary } from "@/lib/tournament-polls"

/**
 * FAN-01 owner-side poll management (dashboard tournament page). Creating a
 * poll is the moderation point: the question and options are OWNER-authored
 * content, and the card says exactly that. Lifecycle is draft -> open ->
 * closed with closed terminal - the UI never offers reopening.
 */

export const POLL_MANAGER_LABELS = {
  title: "Fan Polls",
  createTitle: "New poll",
  questionLabel: "Question",
  optionsLabel: "Options (one per line, 2-10)",
  moderationNote: "You author the question and options - fans only vote, never write.",
  create: "Create poll",
  open: "Open",
  close: "Close",
  closedNote: "Closed polls are final - reopening is not possible.",
  draftBadge: "Draft",
  openBadge: "Open",
  closedBadge: "Closed",
} as const

export function pollStatusBadge(status: string): string {
  if (status === "open") return POLL_MANAGER_LABELS.openBadge
  if (status === "closed") return POLL_MANAGER_LABELS.closedBadge
  return POLL_MANAGER_LABELS.draftBadge
}

/** "2 of 5" style option result line; bounded inputs fall back to em-dash counts. */
export function pollOptionResultLine(counts: number[], index: number): string {
  const value = counts[index]
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-"
  return String(value)
}

export function PollManagementCard({
  tournamentId,
  polls,
}: {
  tournamentId: string
  polls: TournamentPollSummary[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [question, setQuestion] = useState("")
  const [optionsText, setOptionsText] = useState("")

  function createClicked() {
    if (pending) return
    const options = optionsText.split("\n").map(option => option.trim()).filter(option => option.length > 0)
    startTransition(async () => {
      try {
        await createPoll(tournamentId, question, options)
        toast.success("Poll created as a draft")
        setQuestion("")
        setOptionsText("")
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The poll could not be created")
      }
    })
  }

  function statusClicked(pollId: string, status: "open" | "closed") {
    if (pending) return
    startTransition(async () => {
      try {
        const result = await setPollStatus(pollId, status)
        if (result.ok) {
          toast.success(result.status === "open" ? "Poll is open" : "Poll closed")
          router.refresh()
        } else {
          toast.error(result.reason === "terminal_closed"
            ? "Closed polls are final"
            : "That poll has changed - reload and retry")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The poll could not be updated")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          {POLL_MANAGER_LABELS.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="poll-question">{POLL_MANAGER_LABELS.createTitle}</label>
          <Input
            id="poll-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={200}
            placeholder={POLL_MANAGER_LABELS.questionLabel}
            disabled={pending}
          />
          <textarea
            aria-label={POLL_MANAGER_LABELS.optionsLabel}
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
            rows={4}
            maxLength={1600}
            placeholder={POLL_MANAGER_LABELS.optionsLabel}
            disabled={pending}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">{POLL_MANAGER_LABELS.moderationNote}</p>
          <Button type="button" size="sm" onClick={createClicked} disabled={pending}>
            {POLL_MANAGER_LABELS.create}
          </Button>
        </div>

        {polls.length > 0 && (
          <ul className="space-y-3" aria-label={POLL_MANAGER_LABELS.title}>
            {polls.map((poll) => (
              <li key={poll.pollId} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{poll.question}</p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {pollStatusBadge(poll.status)}
                  </span>
                </div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {poll.options.map((option, index) => (
                    <li key={`${poll.pollId}-${index}`}>
                      {index + 1}. {option} - {pollOptionResultLine(poll.counts, index)}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  {poll.status === "draft" && (
                    <Button type="button" size="sm" variant="outline" disabled={pending}
                      onClick={() => statusClicked(poll.pollId, "open")}>
                      {POLL_MANAGER_LABELS.open}
                    </Button>
                  )}
                  {poll.status === "open" && (
                    <Button type="button" size="sm" variant="outline" disabled={pending}
                      onClick={() => statusClicked(poll.pollId, "closed")}>
                      {POLL_MANAGER_LABELS.close}
                    </Button>
                  )}
                  {poll.status === "closed" && (
                    <p className="text-xs text-muted-foreground">{POLL_MANAGER_LABELS.closedNote}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
