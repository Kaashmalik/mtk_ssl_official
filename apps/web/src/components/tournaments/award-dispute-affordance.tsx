"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Loader2, ShieldQuestion } from "lucide-react"
import { raiseAwardDisputeAction } from "@/app/actions/awards"
import { AWARD_DISPUTE_REASONS, AWARD_DISPUTE_REASON_LABELS } from "@mtk/database/lib/award-dispute-policy"

/**
 * Verbatim UI copy for the member's dispute affordance on the public award
 * gallery (Batch 127). Assert-able pure constants, house style.
 */
export const AWARD_DISPUTE_LABELS = {
  action: "Challenge",
  reasonLabel: "Reason",
  open: "Dispute recorded — awaiting review",
  intro: "Registered members may formally challenge an official award. The league's organizer reviews the dispute; challenging never changes the award by itself.",
  successNew: "Dispute recorded — the organizer will review it",
  successReplay: "You already have an open dispute on this award",
  failure: "Failed to record the dispute",
} as const

export function AwardDisputeAffordance({ tournamentId, awardId }: {
  tournamentId: string
  awardId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = useState("")

  const raise = () => {
    if (reason === "") return
    startTransition(async () => {
      try {
        const result = await raiseAwardDisputeAction({ tournamentId, awardId, reason })
        toast.success(result.raised ? AWARD_DISPUTE_LABELS.successNew : AWARD_DISPUTE_LABELS.successReplay)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : AWARD_DISPUTE_LABELS.failure)
      }
    })
  }

  return (
    <div className="mt-2 border-t pt-2">
      <p className="text-xs text-muted-foreground">{AWARD_DISPUTE_LABELS.intro}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Label htmlFor={`dispute-reason-${awardId}`} className="text-xs">{AWARD_DISPUTE_LABELS.reasonLabel}</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id={`dispute-reason-${awardId}`} className="w-64 text-xs">
            <SelectValue placeholder={AWARD_DISPUTE_LABELS.reasonLabel} />
          </SelectTrigger>
          <SelectContent>
            {AWARD_DISPUTE_REASONS.map((value) => (
              <SelectItem key={value} value={value} className="text-xs">{AWARD_DISPUTE_REASON_LABELS[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={raise} disabled={reason === "" || isPending} size="sm" variant="outline" className="text-xs">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldQuestion className="h-3 w-3" />}
          {AWARD_DISPUTE_LABELS.action}
        </Button>
      </div>
    </div>
  )
}

export function AwardDisputePendingNotice() {
  return (
    <p className="text-xs text-muted-foreground mt-2 border-t pt-2">{AWARD_DISPUTE_LABELS.open}</p>
  )
}
