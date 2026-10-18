"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { CheckCircle2, ListOrdered } from "lucide-react"
import { declarePlayingXis, approveXis, substituteInXi } from "@/app/actions/matches"
import { xiAttachKeeper, xiCanDeclare, xiCanSubstitute, xiDeclarationFromSlots, xiGateStatus,
  xiInitialKeeper, xiInitialSlots, xiStatusLabel, xiSubstitutionSelection,
  type ActiveXiPlayer, type UiPlayer, type XiGateState } from "@/lib/xi-card"

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
  teamAId, teamBId, teamAName, teamBName, canDeclare, canApprove, canSubstitute, activeXi, eligible,
}: {
  matchId: string
  matchStatus: string | null
  tournamentId: string | null
  xiRequired: boolean
  xiApprovedAt: Date | string | null
  teamAId: string
  teamBId: string
  teamAName: string
  teamBName: string
  canDeclare: boolean
  canApprove: boolean
  canSubstitute: boolean
  activeXi: { teamA: ActiveXiPlayer[]; teamB: ActiveXiPlayer[] }
  eligible: { teamA: UiPlayer[]; teamB: UiPlayer[] }
}) {
  const router = useRouter()
  const gate: XiGateState = xiGateStatus({ xiRequired, xiApprovedAt })
  const [slotsA, setSlotsA] = useState<(string | null)[]>(() => xiInitialSlots(activeXi.teamA))
  const [slotsB, setSlotsB] = useState<(string | null)[]>(() => xiInitialSlots(activeXi.teamB))
  const [keeperA, setKeeperA] = useState<string | null>(() => xiInitialKeeper(activeXi.teamA))
  const [keeperB, setKeeperB] = useState<string | null>(() => xiInitialKeeper(activeXi.teamB))
  const [isPending, startTransition] = useTransition()
  const declareAllowed = xiCanDeclare({ status: matchStatus, tournamentId })
  const initialA = xiInitialSlots(activeXi.teamA)
  const initialB = xiInitialSlots(activeXi.teamB)
  const aXi = xiDeclarationFromSlots(slotsA.map(v => (v === NONE ? null : v)), teamAName)
  const bXi = xiDeclarationFromSlots(slotsB.map(v => (v === NONE ? null : v)), teamBName)
  const attachedA = xiAttachKeeper(aXi.entries, keeperA)
  const attachedB = xiAttachKeeper(bXi.entries, keeperB)
  const validationError = aXi.error ?? bXi.error ?? attachedA.error ?? attachedB.error
  const dirty = slotsA.some((slot, i) => (slot ?? null) !== (initialA[i] ?? null))
    || slotsB.some((slot, i) => (slot ?? null) !== (initialB[i] ?? null))
    || keeperA !== xiInitialKeeper(activeXi.teamA)
    || keeperB !== xiInitialKeeper(activeXi.teamB)

  const declare = () => startTransition(async () => {
    if (validationError || !attachedA.entries.length || !attachedB.entries.length) {
      toast.error(validationError ?? "Select both teams' playing XIs first")
      return
    }
    try {
      await declarePlayingXis(matchId, attachedA.entries, attachedB.entries)
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

  const [subOutA, setSubOutA] = useState<string | null>(null)
  const [subInA, setSubInA] = useState<string | null>(null)
  const [subOutB, setSubOutB] = useState<string | null>(null)
  const [subInB, setSubInB] = useState<string | null>(null)
  const substituteAllowed = xiCanSubstitute({ xiRequired, status: matchStatus, tournamentId })

  const substitute = (teamId: string, subOut: string | null, subIn: string | null,
    declared: ActiveXiPlayer[], eligibleSide: UiPlayer[], reset: () => void) => {
    const selection = xiSubstitutionSelection(subOut, subIn, declared, eligibleSide)
    if (selection.error) {
      toast.error(selection.error)
      return
    }
    startTransition(async () => {
      try {
        await substituteInXi(matchId, teamId, selection.outgoingPlayerId, selection.incomingPlayerId)
        toast.success("Substitution recorded. The replacement inherits the declared slot.")
        reset()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Substitution failed. Reload and try again.")
      }
    })
  }

  const substitutionPanel = (teamId: string, teamName: string, declared: ActiveXiPlayer[], eligibleSide: UiPlayer[],
    subOut: string | null, subIn: string | null, setOut: (v: string | null) => void, setIn: (v: string | null) => void) => {
    if (!(canSubstitute && substituteAllowed && declared.length === 11)) return null
    const selection = xiSubstitutionSelection(subOut, subIn, declared, eligibleSide)
    const outOptions = [...declared].sort((x, y) => x.battingOrder - y.battingOrder)
      .map(player => <SelectItem key={player.playerId} value={player.playerId}>{player.battingOrder}. {player.name}</SelectItem>)
    const inOptions = eligibleSide
      .filter(player => !declared.some(declaredPlayer => declaredPlayer.playerId === player.id))
      .map(player => <SelectItem key={player.id} value={player.id}>{player.name}</SelectItem>)
    return (
      <div className="mt-3 space-y-1.5">
        <p className="text-xs text-muted-foreground">Substitute into {teamName} (audited):</p>
        <Select value={subOut ?? NONE} onValueChange={v => setOut(v === NONE ? null : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Outgoing player" /></SelectTrigger>
          <SelectContent>{outOptions}</SelectContent>
        </Select>
        <Select value={subIn ?? NONE} onValueChange={v => setIn(v === NONE ? null : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Incoming player" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {inOptions}
          </SelectContent>
        </Select>
        {selection.error && <p className="text-xs text-destructive">{selection.error}</p>}
        <Button size="sm" variant="outline" disabled={isPending || Boolean(selection.error)}
          onClick={() => substitute(teamId, subOut, subIn, declared, eligibleSide, () => { setOut(null); setIn(null) })}>
          {isPending ? "Substituting…" : "Record substitution"}
        </Button>
      </div>
    )
  }

  const sidePanel = (teamId: string, teamName: string, slots: (string | null)[], players: UiPlayer[],
    setSlots: (next: (string | null)[]) => void, declared: ActiveXiPlayer[],
    keeper: string | null, setKeeper: (v: string | null) => void,
    subOut: string | null, subIn: string | null, setOut: (v: string | null) => void, setIn: (v: string | null) => void) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{teamName}</p>
      {declared.length === 11 ? (
        <ol className="text-sm space-y-1">
          {[...declared].sort((x, y) => x.battingOrder - y.battingOrder).map(player => (
            <li key={player.playerId} className="flex items-center gap-2">
              <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{player.battingOrder}. {player.name}</span>
              {player.wicketkeeper === true && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">WK</Badge>
              )}
            </li>
          ))}
          <li className="text-xs text-muted-foreground">
            {declared.some(player => player.wicketkeeper === true)
              ? "The designated wicketkeeper is recorded with the XI."
              : "No wicketkeeper designated for this side (earlier declarations predate the record)."}</li>
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
          <p className="text-xs text-muted-foreground">Designated wicketkeeper (optional, one per side):</p>
          <Select value={keeper && slots.includes(keeper) ? keeper : NONE}
            onValueChange={v => setKeeper(v === NONE ? null : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wicketkeeper" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— none —</SelectItem>
              {slots.filter((slot): slot is string => Boolean(slot)).map(playerId => (
                <SelectItem key={playerId} value={playerId}>
                  {players.find(player => player.id === playerId)?.name ?? playerId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No XI declared for this side yet.</p>
      )}
      {substitutionPanel(teamId, teamName, declared, players, subOut, subIn, setOut, setIn)}
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
          {sidePanel(teamAId, teamAName, slotsA, eligible.teamA, setSlotsA, activeXi.teamA, keeperA, setKeeperA, subOutA, subInA, setSubOutA, setSubInA)}
          {sidePanel(teamBId, teamBName, slotsB, eligible.teamB, setSlotsB, activeXi.teamB, keeperB, setKeeperB, subOutB, subInB, setSubOutB, setSubInB)}
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
