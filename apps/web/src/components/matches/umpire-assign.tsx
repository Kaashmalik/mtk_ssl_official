"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Button } from "@mtk/ui/components/ui/button"
import { assignUmpire, getUmpiresForTenant } from "@/app/actions/matches"

type Umpire = { id: string; displayName: string | null; email: string }
const NONE = "none"

/**
 * Member-bound umpire assignment (COMP-06): pick internal officials from the
 * league's EFFECTIVE members (any role; expired/suspended members are filtered
 * server-side too). The same person cannot hold both slots. Free-text umpire
 * listings for external officials are managed elsewhere and untouched here.
 */
export function UmpireAssign({ matchId, currentUmpire1Id, currentUmpire2Id }: {
  matchId: string; currentUmpire1Id: string | null; currentUmpire2Id: string | null
}) {
  const router = useRouter()
  const [umpires, setUmpires] = useState<Umpire[]>([])
  const [first, setFirst] = useState<string>(currentUmpire1Id ?? NONE)
  const [second, setSecond] = useState<string>(currentUmpire2Id ?? NONE)
  const [pendingSlot, setPendingSlot] = useState<"primary" | "secondary" | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getUmpiresForTenant().then(setUmpires).catch(() => setUmpires([]))
  }, [])

  const save = (slot: "primary" | "secondary", value: string) =>
    startTransition(async () => {
      setPendingSlot(slot)
      try {
        await assignUmpire(matchId, slot, value === NONE ? null : value)
        toast.success(slot === "primary" ? "First umpire saved" : "Second umpire saved")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to assign umpire")
        // Restore the last confirmed server value on rejection.
        if (slot === "primary") setFirst(currentUmpire1Id ?? NONE)
        else setSecond(currentUmpire2Id ?? NONE)
      } finally { setPendingSlot(null) }
    })

  const options = (
    <>
      <SelectItem value={NONE}>Unassigned</SelectItem>
      {umpires.map((s) => <SelectItem key={s.id} value={s.id}>{s.displayName || s.email}</SelectItem>)}
    </>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="first-umpire">First umpire (member)</Label>
          <Select value={first} onValueChange={setFirst}>
            <SelectTrigger id="first-umpire" className="mt-1.5"><SelectValue placeholder="Select a member" /></SelectTrigger>
            <SelectContent>{options}</SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={isPending || first === (currentUmpire1Id ?? NONE)}
          onClick={() => save("primary", first)}
        >
          {pendingSlot === "primary" ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="second-umpire">Second umpire (member)</Label>
          <Select value={second} onValueChange={setSecond}>
            <SelectTrigger id="second-umpire" className="mt-1.5"><SelectValue placeholder="Select a member" /></SelectTrigger>
            <SelectContent>{options}</SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={isPending || second === (currentUmpire2Id ?? NONE)}
          onClick={() => save("secondary", second)}
        >
          {pendingSlot === "secondary" ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Candidates are the league&apos;s current effective members (any role). A member cannot hold both umpire slots, and this never rewrites external free-text umpire listings.</p>
    </div>
  )
}
