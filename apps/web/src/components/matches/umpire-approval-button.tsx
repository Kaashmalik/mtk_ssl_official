"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"
import { toast } from "sonner"
import { approveUmpireAssignment } from "@/app/actions/matches"

/** Umpire consent (COMP-06, mirroring scorer approval): the assigned member
 * umpire's own acknowledgment. The server writer re-verifies the slot and the
 * member's effective membership under a lock, so this control cannot approve
 * on anyone else's behalf and goes stale harmlessly. */
export function UmpireApprovalButton({ matchId }: { matchId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return <Button size="sm" variant="outline" disabled={isPending}
    onClick={() => startTransition(async () => {
      try {
        await approveUmpireAssignment(matchId)
        toast.success("Assignment approved. You are recorded as the approving umpire.")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approval failed. Reload and try again.")
      }
    })}>
    {isPending ? "Approving…" : "Approve my umpire assignment"}
  </Button>
}
