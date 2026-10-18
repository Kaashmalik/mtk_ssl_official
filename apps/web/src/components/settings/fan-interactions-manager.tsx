"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { toast } from "sonner"
import { decideReactionReportAction } from "@/app/actions/fan-reaction-reports"
import { liftFanBlockAction } from "@/app/actions/fan-interaction-blocks"
import { REACTION_REPORT_REASON_LABELS, type ReactionReportReason } from "@mtk/database/lib/fan-reaction-policy"
import { FAN_BLOCK_REASON_LABELS, type FanBlockReason } from "@mtk/database/lib/fan-reaction-policy"

export type QueueReportRow = {
  id: string
  matchId: string
  matchLabel: string
  reason: string
  reporterName: string | null
  createdAt: string
}

export type QueueBlockRow = {
  fanUserId: string
  fanName: string | null
  reason: string
  createdAt: string
}

/**
 * The league-wide fan-interactions queue (FAN-01 completion). Reports from
 * every match in one bounded oldest-first list and the league's blocked
 * fans. Decisions and lifts go through the identical locked writer actions
 * the per-match moderation card uses - this surface only adds visibility,
 * never authority: the writer re-checks the owner gate on every call, and a
 * replay or foreign id returns its honest classification instead of a
 * second decision.
 */
export function FanInteractionsManager({
  initialReports,
  initialBlocks,
}: {
  initialReports: QueueReportRow[]
  initialBlocks: QueueBlockRow[]
}) {
  const [reports, setReports] = useState(initialReports)
  const [blocks, setBlocks] = useState(initialBlocks)
  const [isPending, startTransition] = useTransition()

  const reportLabel = (reason: string) =>
    REACTION_REPORT_REASON_LABELS[reason as ReactionReportReason] ?? reason
  const blockLabel = (reason: string) =>
    FAN_BLOCK_REASON_LABELS[reason as FanBlockReason] ?? reason

  const handleDecide = (reportId: string, decision: "dismissed" | "actioned") => {
    startTransition(async () => {
      try {
        const result = await decideReactionReportAction({ reportId, decision })
        if (!result.decided) {
          if (result.reason === "already_decided") {
            toast.info("This report was already decided - refreshing your view")
          } else {
            toast.info("This report is no longer decidable here")
          }
        }
        // A decided report leaves the queue either way; a replay is
        // surfaced above, never silently re-decided.
        setReports(prev => prev.filter(report => report.id !== reportId))
        if (result.decided) toast.success(decision === "actioned" ? "Report marked actioned" : "Report dismissed")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Decision failed")
      }
    })
  }

  const handleLift = (fanUserId: string) => {
    startTransition(async () => {
      try {
        const result = await liftFanBlockAction({ fanUserId })
        if (result.lifted) {
          setBlocks(prev => prev.filter(block => block.fanUserId !== fanUserId))
          toast.success("Block lifted - the fan can react and report again")
        } else if (result.reason === "already_lifted") {
          toast.info("This block was already lifted - refreshing your view")
          setBlocks(prev => prev.filter(block => block.fanUserId !== fanUserId))
        } else {
          toast.info("No active block found for this fan")
          setBlocks(prev => prev.filter(block => block.fanUserId !== fanUserId))
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Lift failed")
      }
    })
  }

  return (
    <div className="space-y-6">
      <section aria-label="Open fan reports across the league">
        <h2 className="text-lg font-semibold">Open fan reports</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Oldest first - the longest-waiting report is the queue head. Decisions
          record your review; handling a report stays on the match page&apos;s
          moderation card.
        </p>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open reports - the queues are clear.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map(report => (
              <li key={report.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{reportLabel(report.reason)}</Badge>
                  <Link
                    href={`/dashboard/matches/${report.matchId}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {report.matchLabel}
                  </Link>
                  <span className="text-muted-foreground">{report.reporterName ?? "A league member"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDecide(report.id, "actioned")}
                    disabled={isPending}
                    aria-label={`Mark the ${reportLabel(report.reason)} report on ${report.matchLabel} actioned`}
                  >
                    Mark actioned
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDecide(report.id, "dismissed")}
                    disabled={isPending}
                    aria-label={`Dismiss the ${reportLabel(report.reason)} report on ${report.matchLabel}`}
                  >
                    Dismiss
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Fans blocked from league fan interactions">
        <h2 className="text-lg font-semibold">Fans blocked in this league</h2>
        <p className="text-sm text-muted-foreground mb-2">
          A block stops one fan from reacting to or reporting on any match of
          this league. Lifting restores participation immediately.
        </p>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fan is currently blocked.</p>
        ) : (
          <ul className="space-y-2">
            {blocks.map(block => (
              <li key={block.fanUserId} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{blockLabel(block.reason)}</Badge>
                  <span className="text-muted-foreground">{block.fanName ?? "A league member"}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleLift(block.fanUserId)}
                  disabled={isPending}
                  aria-label={`Lift the block on ${block.fanName ?? "this fan"}`}
                >
                  Lift
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
