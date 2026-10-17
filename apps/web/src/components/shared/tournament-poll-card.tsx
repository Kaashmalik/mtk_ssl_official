"use client"

import { useState, useTransition } from "react"
import { Card, CardContent } from "@mtk/ui"
import { Vote } from "lucide-react"
import { toast } from "sonner"
import type { TournamentPollSummary } from "@/lib/tournament-polls"
import { voteOnPoll } from "@/app/actions/polls"

/**
 * FAN-01 fan-facing poll card (public tournament page). Shows ONE open poll
 * with AGGREGATE counts only - never who voted how. A signed-in fan of the
 * league votes by option; switching is allowed until the poll closes.
 * Votes are engagement only - the card says so, in words.
 */

export const POLL_CARD_LABELS = {
  votingHint: "Pick one. You can change your mind while the poll is open.",
  signedOutHint: "Sign in as a fan of this league to vote.",
  disclosure: "Votes are engagement only - they never decide anything official.",
  votesOne: "1 vote",
  votesMany: (n: number) => `${n} votes`,
} as const

export function pollTotalLabel(total: number): string {
  return total === 1 ? POLL_CARD_LABELS.votesOne : POLL_CARD_LABELS.votesMany(total)
}

export function pollSharePercent(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * 100)
}

export function TournamentPollCard({
  poll,
  myVote,
  canVote,
}: {
  poll: TournamentPollSummary
  myVote: number | null
  canVote: boolean
}) {
  const [votedIndex, setVotedIndex] = useState<number | null>(myVote)
  const [counts, setCounts] = useState<number[]>(poll.counts)
  const [pending, startTransition] = useTransition()

  function optionClicked(index: number) {
    if (!canVote || pending) return
    startTransition(async () => {
      try {
        const result = await voteOnPoll(poll.pollId, index)
        if (result.action === "refused" || !result.counts || result.counts.length === 0) {
          // Refusals are state changes (poll closed under us) - leave the
          // shown counts alone and let a refresh tell the truth.
          return
        }
        setCounts(result.counts)
        setVotedIndex(result.action === "switched" || result.action === "recorded" ? index : votedIndex)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign in to vote"
        toast.error(message)
      }
    })
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-2">
          <Vote className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">{poll.question}</p>
        </div>
        <div role="group" aria-label={poll.question} className="space-y-2">
          {poll.options.map((option, index) => {
            const active = votedIndex === index
            const percent = pollSharePercent(counts[index] ?? 0, poll.total)
            return (
              <button
                key={`${poll.pollId}-${index}`}
                type="button"
                aria-pressed={active}
                disabled={!canVote || pending}
                onClick={() => optionClicked(index)}
                className="w-full text-left rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-70 data-[active=true]:border-yellow-600 data-[active=true]:bg-yellow-500/10"
                data-active={active}
              >
                <span className="flex items-center justify-between gap-2">
                  <span>{option}</span>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {pollSharePercent(counts[index] ?? 0, poll.total)}% ({counts[index] ?? 0})
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="mt-1 block h-1 rounded bg-muted"
                >
                  <span
                    className="block h-1 rounded bg-yellow-600"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pollTotalLabel(poll.total)}
          {" - "}
          {canVote ? POLL_CARD_LABELS.votingHint : POLL_CARD_LABELS.signedOutHint}
        </p>
        <p className="text-[11px] text-muted-foreground">{POLL_CARD_LABELS.disclosure}</p>
      </CardContent>
    </Card>
  )
}
