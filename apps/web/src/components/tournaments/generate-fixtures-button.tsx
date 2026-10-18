"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { CalendarPlus, Loader2 } from "lucide-react"
import { generateFixtures } from "@/app/actions/tournaments"

/**
 * Generates the tournament's fixtures from its approved registrations
 * (Batch 49's locked writer). This starts the competition: the tournament
 * becomes live and registration closes, so the control only offers itself
 * while the tournament sits in `registration`. Failures (no approved teams,
 * capacity, fixtures already existing, competition locked) surface as
 * toasts - the writer is the authority.
 */
export function GenerateFixturesButton({ tournamentId }: {
  tournamentId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const generate = () => {
    startTransition(async () => {
      try {
        const result = await generateFixtures(tournamentId)
        const count = Array.isArray(result.fixtures) ? result.fixtures.length : 0
        toast.success(`Generated ${count} fixture${count === 1 ? "" : "s"} - tournament is live`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to generate fixtures")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={generate}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
      Generate fixtures
    </Button>
  )
}
