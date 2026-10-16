"use client"

import React, { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"
import { toast } from "sonner"
import { approveScorerAssignment } from "@/app/actions/matches"

/** Official approval (COMP-06/IAM-06): the assigned scorer's own consent. The
 * server writer re-verifies the slot under a lock, so this control cannot
 * approve on anyone else's behalf and goes stale harmlessly. */
export function ScorerApprovalButton({ matchId }: { matchId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return <Button size="sm" variant="outline" disabled={isPending}
    onClick={() => startTransition(async () => {
      try {
        await approveScorerAssignment(matchId)
        toast.success("Assignment approved. You are recorded as the approving official.")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approval failed. Reload and try again.")
      }
    })}>
    {isPending ? "Approving…" : "Approve my scorer assignment"}
  </Button>
}
