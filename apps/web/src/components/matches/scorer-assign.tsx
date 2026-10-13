"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Button } from "@mtk/ui/components/ui/button"
import { assignScorer, getScorersForTenant } from "@/app/actions/matches"

type Scorer = { id: string; displayName: string | null; email: string }
const NONE = "none"

/**
 * Assign a primary and an optional backup scorer. Both are validated server-side
 * as active scorer-role members of this league, and the same person cannot hold
 * both slots.
 */
export function ScorerAssign({ matchId, currentScorerId, currentBackupScorerId }: {
  matchId: string; currentScorerId: string | null; currentBackupScorerId: string | null
}) {
  const router = useRouter()
  const [scorers, setScorers] = useState<Scorer[]>([])
  const [primary, setPrimary] = useState<string>(currentScorerId ?? NONE)
  const [backup, setBackup] = useState<string>(currentBackupScorerId ?? NONE)
  const [pendingSlot, setPendingSlot] = useState<"primary" | "backup" | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getScorersForTenant().then(setScorers).catch(() => setScorers([]))
  }, [])

  const save = (slot: "primary" | "backup", value: string) =>
    startTransition(async () => {
      setPendingSlot(slot)
      try {
        await assignScorer(matchId, slot, value === NONE ? null : value)
        toast.success(slot === "primary" ? "Primary scorer saved" : "Backup scorer saved")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to assign scorer")
        // Restore the last confirmed server value on rejection.
        if (slot === "primary") setPrimary(currentScorerId ?? NONE)
        else setBackup(currentBackupScorerId ?? NONE)
      } finally { setPendingSlot(null) }
    })

  const options = (
    <>
      <SelectItem value={NONE}>Unassigned</SelectItem>
      {scorers.map((s) => <SelectItem key={s.id} value={s.id}>{s.displayName || s.email}</SelectItem>)}
    </>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="primary-scorer">Primary scorer</Label>
          <Select value={primary} onValueChange={setPrimary}>
            <SelectTrigger id="primary-scorer" className="mt-1.5"><SelectValue placeholder="Select a scorer" /></SelectTrigger>
            <SelectContent>{options}</SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={isPending || primary === (currentScorerId ?? NONE)}
          onClick={() => save("primary", primary)}
        >
          {pendingSlot === "primary" ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="backup-scorer">Backup scorer</Label>
          <Select value={backup} onValueChange={setBackup}>
            <SelectTrigger id="backup-scorer" className="mt-1.5"><SelectValue placeholder="Select a backup" /></SelectTrigger>
            <SelectContent>{options}</SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={isPending || backup === (currentBackupScorerId ?? NONE)}
          onClick={() => save("backup", backup)}
        >
          {pendingSlot === "backup" ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Either assigned scorer may record for this match. Primary and backup must be different people.</p>
    </div>
  )
}
