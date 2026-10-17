"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { CheckCircle2, ListOrdered } from "lucide-react"
import { declarePlayingXis, approveXis } from "@/app/actions/matches"
import { xiCanDeclare, xiDeclarationFromSlots, xiGateStatus, xiInitialSlots, xiStatusLabel,
  type ActiveXiPlayer, type XiGateState } from "@/lib/xi-card"

type UiPlayer = { id: string; name: string }
const NONE = "__unselected__"

/**
 * Declared playing XIs (COMP-06 slice, Batch 81). Presentation only: an owner
 * or the assigned scorer stores both sides' squads; an owner or the assigned
 * member umpire approving is gated by the locked, audited server writers,
 * which re-verify authority, registration squads, roster sides and the
 * exactly-11 shape under the match row lock. This card cannot approve on
 * anyone else's behalf and goes stale harmlessly.
 */
export function PlayingXiCard({
  matchId, matchStatus, tournamentId, xiRequired, xiApprovedAt,
  teamAName, teamBName, canDeclare, canApprove, activeXi, eligible,
}: {
  matchId: string
  matchStatus: string | null
  tournamentId: string | null
  xiRequired: boolean
  xiApprovedAt: Date | string | null
  teamAName: string
  teamBName: string
  canDeclare: boolean
  canApprove: boolean
  activeXi: { teamA: ActiveXiPlayer[]; teamB: ActiveXiPlayer[] }
  eligible: { teamA: UiPlayer[]; teamB: UiPlayer[] }
}) {
  const router = useRouter()
  const gate: XiGateState = xiGateStatus({ xiRequired, xiApprovedAt })
  const [slotsA, setSlotsA] = useState<(string | null)[]>(() => xiInitialSlots(activeXi.teamA))
  const [slotsB, setSlotsB] = useState<(string | null)[]>(() => xiInitialSlots(activeXi.teamB))
  const [isPending, startTransition] = useTransition()
  const declareAllowed = xiCanDeclare({ status: matchStatus, tournamentId })
  const initialA = xiInitialSlots(activeXi.teamA)
  const initialB = xiInitialSlots(activeXi.teamB)
  const aXi = xiDeclarationFromSlots(slotsA.map(v => (v === NONE ? null : v)), teamAName)
  const bXi = xiDeclarationFromSlots(slotsB.map(v => (v === NONE ? null : v)), teamBName)
  const validationError = aXi.error ?? bXi.error
  const dirty = slotsA.some((slot, i) => (slot ?? null) !== (initialA[i] ?? null))
    || slotsB.some((slot, i) => (slot ?? null) !== (initialB[i] ?? null))

  const declare = () => startTransition(async () => {
    if (validationError || !aXi.entries.length || !bXi.entries.length) {
      toast.error(validationError ?? "Select both teams' playing XIs first")
      return
    }
    try {
      await declarePlayingXis(matchId, aXi.entries, bXi.entries)
      toast.success("Playing XIs declared. An official must approve them before play.")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Declaration failed. Reload and try again.")
    }
  })

  const approve = () => startTransition(async () => {
    try {
      await approveXis(matchId)
      toast.success("Playing XIs approved. Delivery participants are now bound to the declared squads.")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed. Reload and try again.")
    }
  })

  const sidePanel = (teamName: string, slots: (string | null)[], players: UiPlayer[],
    setSlots: (next: (string | null)[]) => void, declared: ActiveXiPlayer[]) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{teamName}</p>
      {declared.length === 11 ? (
        <ol className="text-sm space-y-1">
          {[...declared].sort((x, y) => x.battingOrder - y.battingOrder).map(player => (
            <li key={player.playerId} className="flex items-center gap-2">
              <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{player.battingOrder}. {player.name}</span>
            </li>
          ))}
        </ol>
      ) : canDeclare && declareAllowed ? (
        <div className="grid gap-1.5">
          {slots.map((slot, i) => (
            <Select key={i} value={slot ?? NONE}
              onValueChange={value => setSlots(slots.map((current, j) => (j === i ? (value === NONE ? null : value) : current)))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`Slot ${i + 1}`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {players.map(player => <SelectItem key={player.id} value={player.id}>{player.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No XI declared for this side yet.</p>
      )}
    </div>
  )

  return (
    <Card className="border-none shadow-lg bg-card/50 backdrop-blur-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          Playing XIs
          <Badge variant={gate === "approved" ? "default" : gate === "pendingApproval" ? "secondary" : "outline"}>
            {xiStatusLabel(gate, xiApprovedAt)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {gate === "pendingApproval" && !canApprove && (
          <p className="text-xs text-muted-foreground">
            Both sides are declared. An official (the league owner or an assigned umpire) must approve them before play.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {sidePanel(teamAName, slotsA, eligible.teamA, setSlotsA, activeXi.teamA)}
          {sidePanel(teamBName, slotsB, eligible.teamB, setSlotsB, activeXi.teamB)}
        </div>
        {validationError && canDeclare && declareAllowed && (
          <p className="text-xs text-destructive">{validationError}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canDeclare && declareAllowed && (
            <Button size="sm" disabled={isPending || !dirty || Boolean(validationError)} onClick={declare}>
              {isPending ? "Declaring…" : "Store declared XIs"}
            </Button>
          )}
          {canApprove && gate === "pendingApproval" && (
            <Button size="sm" variant="outline" disabled={isPending}
              onClick={approve}>
              <CheckCircle2 className="h-4 w-4 mr-1" />{isPending ? "Approving…" : "Approve both XIs"}
            </Button>
          )}
          {!declareAllowed && tournamentId === null && (
            <p className="text-xs text-muted-foreground">Playing XIs apply to competition matches, not friendlies.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
