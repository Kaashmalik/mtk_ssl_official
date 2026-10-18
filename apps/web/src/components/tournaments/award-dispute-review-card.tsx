"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Loader2, Gavel } from "lucide-react"
import { resolveAwardDisputeAction } from "@/app/actions/awards"
import type { OpenAwardDisputeRow } from "@/lib/award-dispute-records"

/**
 * Verbatim UI copy for the organizer's dispute-review queue (Batch 127).
 * Assert-able pure constants, house style.
 */
export const AWARD_DISPUTE_REVIEW_LABELS = {
  title: "Award disputes",
  intro: "Registered members' formal challenges to declared awards. Resolving a dispute ONLY records the decision — an upheld dispute never changes the award itself; correct the award separately if the review warrants it.",
  queueTitle: "Open disputes",
  queueEmpty: "No open award disputes.",
  upheld: "Uphold",
  dismissed: "Dismiss",
  decisionLabel: "Decide",
  success: "Dispute decision recorded",
  successReplay: "This dispute is already decided",
  failure: "Failed to record the decision",
  raisedByUnavailable: "Member record unavailable",
} as const

export function AwardDisputeReviewCard({ disputes }: {
  disputes: OpenAwardDisputeRow[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const resolve = (disputeId: string, decision: "upheld" | "dismissed") => {
    setBusyId(disputeId)
    startTransition(async () => {
      try {
        const result = await resolveAwardDisputeAction({ disputeId, decision })
        toast.success(result.decided ? AWARD_DISPUTE_REVIEW_LABELS.success : AWARD_DISPUTE_REVIEW_LABELS.successReplay)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : AWARD_DISPUTE_REVIEW_LABELS.failure)
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Gavel className="h-4 w-4" />{AWARD_DISPUTE_REVIEW_LABELS.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{AWARD_DISPUTE_REVIEW_LABELS.intro}</p>
        <span className="text-sm font-semibold">{AWARD_DISPUTE_REVIEW_LABELS.queueTitle}</span>
        {disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-1">{AWARD_DISPUTE_REVIEW_LABELS.queueEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {disputes.map((dispute) => (
              <li key={dispute.disputeId} data-testid="open-award-dispute" className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{dispute.category as string}</span>
                  <Badge variant="outline" className="text-[10px]">{AWARD_DISPUTE_REVIEW_LABELS.decisionLabel}</Badge>
                </div>
                <p className="text-sm mt-1">{dispute.reasonLabel}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dispute.raisedByName ?? AWARD_DISPUTE_REVIEW_LABELS.raisedByUnavailable}
                  {" · raised "}{dispute.raisedAt.toISOString().slice(0, 10)}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm" variant="outline" className="text-xs"
                    disabled={isPending}
                    onClick={() => resolve(dispute.disputeId, "upheld")}
                  >
                    {isPending && busyId === dispute.disputeId ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {AWARD_DISPUTE_REVIEW_LABELS.upheld}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="text-xs"
                    disabled={isPending}
                    onClick={() => resolve(dispute.disputeId, "dismissed")}
                  >
                    {AWARD_DISPUTE_REVIEW_LABELS.dismissed}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
