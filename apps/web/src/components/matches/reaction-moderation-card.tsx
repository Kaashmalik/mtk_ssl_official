"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { toast } from "sonner"
import { removeModeratedReaction } from "@/app/actions/fan-reaction-moderation"
import { decideReactionReportAction } from "@/app/actions/fan-reaction-reports"
import { blockFanInteractionAction, liftFanBlockAction } from "@/app/actions/fan-interaction-blocks"
import { FAN_REACTION_LABELS, type FanReactionType } from "@mtk/database/lib/fan-reaction-policy"
import { REACTION_REPORT_REASON_LABELS, type ReactionReportReason } from "@mtk/database/lib/fan-reaction-policy"
import { FAN_BLOCK_REASON_LABELS, type FanBlockReason } from "@mtk/database/lib/fan-reaction-policy"

export type ModeratableReactionRow = {
  id: string
  reaction: FanReactionType
  userId: string
  fanName: string | null
  createdAt: string
}

export type ReactionReportRow = {
  id: string
  reason: string
  reporterName: string | null
  createdAt: string
}

export type FanInteractionBlockRow = {
  fanUserId: string
  fanName: string | null
  reason: string
  createdAt: string
}

/**
 * Owner-only moderation card (FAN-01). The public surface shows aggregates
 * only; this is where the league owner sees individual reaction rows on their
 * match and may remove one. Removal is audited server-side; here a successful
 * remove simply drops the row, an already-gone row reports honestly.
 */
export function ReactionModerationCard({
  matchId,
  initialReactions,
  initialReports,
  initialBlocks,
}: {
  matchId: string
  initialReactions: ModeratableReactionRow[]
  initialReports: ReactionReportRow[]
  initialBlocks: FanInteractionBlockRow[]
}) {
  const [rows, setRows] = useState(initialReactions)
  const [reports, setReports] = useState(initialReports)
  const [blocks, setBlocks] = useState(initialBlocks)
  const [isPending, startTransition] = useTransition()

  const handleRemove = (reactionId: string) => {
    startTransition(async () => {
      try {
        const result = await removeModeratedReaction({ matchId, reactionId })
        if (!result.removed) {
          toast.error("This reaction is already gone - refreshing your view")
        }
        setRows(prev => prev.filter(row => row.id !== reactionId))
        if (result.removed) toast.success("Reaction removed")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Removal failed")
      }
    })
  }

  const handleDecide = (reportId: string, decision: "dismissed" | "actioned") => {
    startTransition(async () => {
      try {
        const result = await decideReactionReportAction({ reportId, decision })
        if (!result.decided) {
          if (result.reason === "already_decided") {
            toast.info("This report was already decided - refreshing your view")
          } else {
            toast.error("This report is no longer decidable")
          }
        }
        // A decided report leaves the queue either way; a replay is surfaced
        // honestly above, never silently re-decided.
        setReports(prev => prev.filter(report => report.id !== reportId))
        if (result.decided) toast.success(decision === "actioned" ? "Report marked actioned" : "Report dismissed")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Decision failed")
      }
    })
  }

  const blockLabel = (reason: string) =>
    FAN_BLOCK_REASON_LABELS[reason as FanBlockReason] ?? reason

  const handleBlock = (fanUserId: string, fanName: string | null) => {
    startTransition(async () => {
      try {
        const result = await blockFanInteractionAction({ fanUserId, reason: "reaction_abuse" })
        if (result.action === "blocked") {
          // Optimistic queue entry: the writer's audit is the provenance;
          // the list snapshot refreshes on the next page load.
          setBlocks(prev => prev.some(block => block.fanUserId === fanUserId)
            ? prev
            : [{
                fanUserId,
                fanName,
                reason: "reaction_abuse",
                createdAt: new Date().toISOString(),
              }])
          toast.success("Fan blocked from reacting and reporting in this league")
        } else if (result.action === "already_blocked") {
          toast.info("This fan is already blocked in this league")
        } else {
          toast.error("Blocking failed")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Blocking failed")
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

  const reportLabel = (reason: string) =>
    REACTION_REPORT_REASON_LABELS[reason as ReactionReportReason] ?? reason

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fan reaction moderation</CardTitle>
        <p className="text-xs text-muted-foreground">
          Reactions are engagement only - removing one never affects scores,
          standings or awards. The public page shows counts without names.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reactions to moderate on this match.</p>
        ) : (
          <ul className="space-y-2" aria-label="Individual reactions on this match">
            {rows.map(row => (
              <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{FAN_REACTION_LABELS[row.reaction]}</Badge>
                  <span className="text-muted-foreground">{row.fanName ?? "A league member"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBlock(row.userId, row.fanName)}
                    disabled={isPending}
                    aria-label={`Block ${row.fanName ?? "this fan"} from league fan interactions`}
                  >
                    Block fan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemove(row.id)}
                    disabled={isPending}
                    aria-label={`Remove the ${FAN_REACTION_LABELS[row.reaction]} reaction`}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* FAN-01 reports slice: the fan-reported reaction-feed queue. A
            decision records provenance (reviewer + time) server-side;
            handling an actioned report itself stays in the remove flow. */}
        {reports.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium mb-2">Open reports on this match&apos;s reactions</p>
            <ul className="space-y-2" aria-label="Open fan reports on this match">
              {reports.map(report => (
                <li key={report.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{reportLabel(report.reason)}</Badge>
                    <span className="text-muted-foreground">
                      {report.reporterName ?? "A league member"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDecide(report.id, "actioned")}
                      disabled={isPending}
                      aria-label={`Mark the ${reportLabel(report.reason)} report actioned`}
                    >
                      Mark actioned
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDecide(report.id, "dismissed")}
                      disabled={isPending}
                      aria-label={`Dismiss the ${reportLabel(report.reason)} report`}
                    >
                      Dismiss
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* FAN-01 anti-abuse slice: league-scoped blocked fans with lift.
            Lifting restores participation immediately (enforcement re-reads
            the active set on every engagement write); history is kept. */}
        {blocks.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium mb-2">Fans blocked in this league</p>
            <ul className="space-y-2" aria-label="Fans blocked from league fan interactions">
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
