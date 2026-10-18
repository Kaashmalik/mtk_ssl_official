"use client"

import { useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { toast } from "sonner"
import { reportMatchReactionFeedAction } from "@/app/actions/fan-reaction-reports"
import { REACTION_REPORT_REASONS, REACTION_REPORT_REASON_LABELS } from "@mtk/database/lib/fan-reaction-policy"

/**
 * Fan-side report affordance for a match's reaction FEED (FAN-01 reports
 * slice). The public bar shows aggregates only, so a fan reports the feed
 * itself - never a specific row. Reasons are a fixed platform-chosen set; the
 * writer is replay-safe (an open report degrades to `already_open`) and
 * fail-closed refusals are surfaced honestly as toasts.
 */
export function ReactionFeedReport({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(reason: (typeof REACTION_REPORT_REASONS)[number]) {
    startTransition(async () => {
      const result = await reportMatchReactionFeedAction({ matchId, reason })
      if (result.action === "open") {
        toast.success("Report sent to the league organizer")
        setOpen(false)
      } else if (result.action === "already_open") {
        toast.info("You already have an open report for this match")
        setOpen(false)
      } else if (result.reason === "report_rate_limited") {
        toast.error("Too many reports too quickly - please wait a minute")
      } else if (result.reason === "blocked") {
        toast.error("Your fan interactions are currently blocked in this league")
        setOpen(false)
      } else {
        toast.error("Reporting is not available for this match")
      }
    })
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-white/50 hover:text-white text-xs h-7"
        onClick={() => setOpen(true)}
      >
        Report reactions
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-white/50">Report this match&apos;s reactions:</span>
      {REACTION_REPORT_REASONS.map(reason => (
        <Button
          key={reason}
          variant="outline"
          size="sm"
          className="text-xs h-7 border-white/20 text-white/70 hover:text-white"
          disabled={pending}
          onClick={() => submit(reason)}
        >
          {REACTION_REPORT_REASON_LABELS[reason]}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-7 text-white/40 hover:text-white"
        disabled={pending}
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  )
}
