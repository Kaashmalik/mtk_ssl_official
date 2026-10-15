"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Loader2, Archive, ArchiveRestore } from "lucide-react"
import { archiveVenue, restoreVenue } from "@/app/actions/venues"

/**
 * Archive/restore toggle for a venue row. The server actions re-resolve the exact
 * active league and re-check `venue:manage`, and archive (never hard-delete) so
 * historical match links survive.
 */
export function VenueRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const run = () => startTransition(async () => {
    try {
      const result = isActive ? await archiveVenue(id) : await restoreVenue(id)
      if (!result.success) throw new Error("Venue could not be updated")
      toast.success(isActive ? "Venue archived" : "Venue restored")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update venue")
    }
  })

  return (
    <Button variant="ghost" size="sm" onClick={run} disabled={isPending}>
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : isActive ? <><Archive className="h-3.5 w-3.5 mr-1.5" />Archive</>
        : <><ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />Restore</>}
    </Button>
  )
}
