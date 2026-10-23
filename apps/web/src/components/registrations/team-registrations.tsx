"use client"

import { useState } from "react"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mtk/ui/components/ui/dialog"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { updateRegistrationSquad, withdrawRegistration } from "@/app/actions/registrations"
import { canEditRegistrationSquad, canWithdrawRegistrationEntry, describeEligibility, evaluateSquadEligibility } from "@mtk/database/lib/registration-eligibility-policy"
import { WithdrawDialog } from "@/components/registrations/withdraw-dialog"

/**
 * ENH-05-03 slice 2: the registered team's own tournament entries on the team
 * detail page. The eligibility sentence is the shared policy's TRUTHFUL answer
 * computed server-side (including "minimum squad size is not configured" —
 * nothing is invented). The squad edit is offered only to an authority holder
 * (canManage is the page's roster-authority decision) and only while the entry
 * still awaits review; the service revalidates everything anyway.
 */

export interface TeamRegistrationEntry {
  id: string
  tournamentName: string
  status: string
  paymentStatus: string
  squadPlayerIds: string[]
  eligibility: string
}

export interface TeamRegistrationsProps {
  registrations: TeamRegistrationEntry[]
  roster: { id: string; name: string }[]
  canManage: boolean
}

export function TeamRegistrations({ registrations, roster, canManage }: TeamRegistrationsProps) {
  const [entries, setEntries] = useState(registrations)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  // ENH-05-03 slice 5: withdrawing this team's OWN entry, with the shared
  // truthful confirmation. The service re-checks the transition server-side.
  const [withdrawTarget, setWithdrawTarget] = useState<TeamRegistrationEntry | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const openEditor = (entry: TeamRegistrationEntry) => {
    setSelected(entry.squadPlayerIds.filter(id => roster.some(player => player.id === id)))
    setEditingId(entry.id)
  }

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id])
  }

  const saveSquad = async () => {
    const id = editingId
    if (!id || selected.length === 0) return
    setSaving(true)
    try {
      const res = await updateRegistrationSquad(id, { squadPlayerIds: selected })
      if (res.success) {
        setEntries(prev => prev.map(entry => entry.id === id ? { ...entry, squadPlayerIds: [...selected] } : entry))
        toast.success(res.changed ? "Squad updated." : "Squad was already up to date.")
        setEditingId(null)
      } else {
        toast.error("Failed to update the squad")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update the squad")
    } finally {
      setSaving(false)
    }
  }

  const confirmWithdraw = async () => {
    const id = withdrawTarget?.id
    if (!id) return
    setWithdrawing(true)
    try {
      const res = await withdrawRegistration(id)
      if (res.success) {
        setEntries(prev => prev.map(entry => entry.id === id ? {
          ...entry,
          status: "withdrawn",
          eligibility: describeEligibility(evaluateSquadEligibility({
            approvalStatus: "withdrawn", paymentStatus: entry.paymentStatus,
            squadSize: entry.squadPlayerIds.length, minSquadSize: -1,
          })),
        } : entry))
        toast.success("Registration withdrawn. You can register again while the window is open.")
        setWithdrawTarget(null)
      } else {
        toast.error("Failed to withdraw the registration")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to withdraw the registration")
    } finally {
      setWithdrawing(false)
    }
  }

  const editing = entries.find(entry => entry.id === editingId) ?? null

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card divide-y">
        {entries.map((entry) => (
          <div key={entry.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{entry.tournamentName}</p>
              <p className="text-xs text-muted-foreground" role="status">{entry.eligibility}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs capitalize">{entry.status}</Badge>
              <Badge variant="outline" className="text-xs capitalize">{String(entry.paymentStatus)}</Badge>
              <span className="text-sm tabular-nums">{entry.squadPlayerIds.length} {entry.squadPlayerIds.length === 1 ? "player" : "players"}</span>
              {canManage && canEditRegistrationSquad(entry.status) ? (
                <Button variant="outline" size="sm" onClick={() => openEditor(entry)} disabled={saving}>
                  Edit squad
                </Button>
              ) : null}
              {canManage && canWithdrawRegistrationEntry(entry.status) ? (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setWithdrawTarget(entry)} disabled={withdrawing}>
                  Withdraw
                </Button>
              ) : null}            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No tournament registrations for this team yet.
          </p>
        )}
      </div>

      <Dialog open={!!editingId} onOpenChange={(open) => !open && !saving && setEditingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit registered squad</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.tournamentName}: pick the players that will represent this team.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto py-2">
            {roster.map((player) => {
              const checked = selected.includes(player.id)
              return (
                <Button
                  key={player.id}
                  type="button"
                  variant={checked ? "default" : "outline"}
                  size="sm"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={player.name}
                  onClick={() => toggle(player.id)}
                  disabled={saving}
                  className="w-full justify-start"
                >
                  <span
                    className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${
                      checked ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  {player.name}
                </Button>
              )
            })}
            {roster.length === 0 && (
              <p className="text-sm text-muted-foreground">No active players are on this roster yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveSquad} disabled={saving || selected.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save squad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {withdrawTarget && (
        <WithdrawDialog
          teamName="This team"
          tournamentName={withdrawTarget.tournamentName}
          saving={withdrawing}
          onConfirm={confirmWithdraw}
          onClose={() => setWithdrawTarget(null)}
        />
      )}
    </div>
  )
}
