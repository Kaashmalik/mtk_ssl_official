"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Button } from "@mtk/ui/components/ui/button"
import { assignScorer, getScorersForTenant } from "@/app/actions/matches"

export function ScorerAssign({ matchId, currentScorerId }: { matchId: string; currentScorerId: string | null }) {
  const [scorers, setScorers] = useState<{ id: string; displayName: string | null; email: string }[]>([])
  const [value, setValue] = useState<string>(currentScorerId ?? "")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getScorersForTenant().then(setScorers).catch(() => setScorers([]))
  }, [])

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Label>Assigned Scorer</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select a scorer" /></SelectTrigger>
          <SelectContent>
            {scorers.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.displayName || s.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        disabled={isPending || !value}
        onClick={() =>
          startTransition(async () => {
            try {
              await assignScorer(matchId, value)
              toast.success("Scorer assigned")
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to assign scorer")
            }
          })
        }
      >
        Assign
      </Button>
    </div>
  )
}
