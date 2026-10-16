"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Loader2 } from "lucide-react"
import { advanceTournament } from "@/app/actions/tournaments"

/**
 * Advances a knockout tournament to its next bracket stage from decided
 * results; when the final is decided, completing the tournament finishes it.
 * Failures (unfinished fixtures, no-results) surface as toasts — the writer
 * is the authority.
 */
export function AdvanceTournamentButton({ tournamentId, completed }: {
  tournamentId: string
  completed?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const advance = () => {
    startTransition(async () => {
      try {
        const result = await advanceTournament(tournamentId)
        if (result.completed) toast.success("Tournament completed")
        else if (result.stage) toast.success(`Advanced to ${result.stage}`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to advance the tournament")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={advance}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : completed ? "Complete Tournament" : "Advance Stage"}
    </Button>
  )
}
