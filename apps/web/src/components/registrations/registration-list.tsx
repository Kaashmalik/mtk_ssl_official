"use client"

import React, { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mtk/ui/components/ui/table"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mtk/ui/components/ui/dialog"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { approveRegistration, rejectRegistration, updateRegistrationSquad, getRegistrationSquadOptions, withdrawRegistration } from "@/app/actions/registrations"
import { canEditRegistrationSquad, canWithdrawRegistrationEntry, describeEligibility, evaluateSquadEligibility } from "@mtk/database/lib/registration-eligibility-policy"
import { WithdrawDialog } from "@/components/registrations/withdraw-dialog"

export interface Registration {
  id: string
  teamId: string
  teamName: string
  tournamentName: string
  squadCount: number
  squadPlayerIds: string[]
  eligibility: string
  registrationFee: string
  notes: string | null
  status: "pending" | "approved" | "rejected" | "withdrawn" | "waitlisted"
  paymentStatus: "unpaid" | "paid" | "refunded" | "waived"
  createdAt: Date
}

interface RegistrationListProps {
  initialRegistrations: Registration[]
}

export function RegistrationList({ initialRegistrations }: RegistrationListProps) {
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegistrations)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  // ENH-05-03 slice 4: console-side squad editing. The affordance exists only
  // for pending/waitlisted entries (canEditRegistrationSquad) and the service
  // revalidates authority, the active roster and the transition server-side.
  const [editingReg, setEditingReg] = useState<Registration | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null)
  const [saving, setSaving] = useState(false)

  const [withdrawTarget, setWithdrawTarget] = useState<Registration | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const confirmWithdraw = async () => {
    const reg = withdrawTarget
    if (!reg) return
    setWithdrawing(true)
    try {
      const res = await withdrawRegistration(reg.id)
      if (res.success) {
        setRegistrations(prev => prev.map(row => row.id === reg.id ? {
          ...row,
          status: "withdrawn" as const,
          eligibility: describeEligibility(evaluateSquadEligibility({
            approvalStatus: "withdrawn", paymentStatus: row.paymentStatus,
            squadSize: row.squadPlayerIds.length, minSquadSize: -1,
          })),
        } : row))
        toast.success("Registration withdrawn. The team can register again while the window is open.")
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

  const openSquadEditor = async (reg: Registration) => {
    setEditingReg(reg)
    setSelected(reg.squadPlayerIds)
    setOptions(null) // loading until the fetch resolves
    try {
      const roster = await getRegistrationSquadOptions(reg.teamId)
      setOptions(roster)
      // Only players still on the ACTIVE roster can be re-submitted; the rest
      // would be refused by the service anyway, so they are never offered.
      setSelected(reg.squadPlayerIds.filter(id => roster.some(player => player.id === id)))
    } catch (err: any) {
      setEditingReg(null)
      toast.error(err.message || "Failed to load the team's players")
    }
  }

  const toggleSquad = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id])
  }

  const saveSquad = async () => {
    const reg = editingReg
    if (!reg || selected.length === 0) return
    setSaving(true)
    try {
      const res = await updateRegistrationSquad(reg.id, { squadPlayerIds: selected })
      if (res.success) {
        setRegistrations(prev => prev.map(row => row.id === reg.id ? {
          ...row,
          squadPlayerIds: [...selected],
          squadCount: selected.length,
          eligibility: describeEligibility(evaluateSquadEligibility({
            approvalStatus: row.status, paymentStatus: row.paymentStatus,
            squadSize: selected.length, minSquadSize: -1,
          })),
        } : row))
        toast.success(res.changed ? "Squad updated." : "Squad was already up to date.")
        setEditingReg(null)
      } else {
        toast.error("Failed to update the squad")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update the squad")
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (id: string) => {
    setUpdatingId(id)
    try {
      const res = await approveRegistration(id)
      if (res.success) {
        setRegistrations(prev => prev.map(r => r.id === id ? { ...r, status: "approved" as const } : r))
        toast.success("Registration approved successfully!")
      } else {
        toast.error("Failed to approve registration")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to approve registration")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRejectSubmit = async () => {
    if (!rejectingId) return
    setUpdatingId(rejectingId)
    const targetId = rejectingId
    setRejectingId(null) // close modal
    
    try {
      const res = await rejectRegistration(targetId, rejectionReason)
      if (res.success) {
        setRegistrations(prev => prev.map(r => r.id === targetId ? { ...r, status: "rejected" as const } : r))
        toast.success("Registration rejected successfully")
        setRejectionReason("")
      } else {
        toast.error("Failed to reject registration")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to reject registration")
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Tournament</TableHead>
              <TableHead>Squad Size</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.map((reg) => {
              const isPending = reg.status === "pending"
              const isUpdating = updatingId === reg.id

              return (
                <TableRow key={reg.id} className="hover:bg-muted/10">
                  <TableCell>
                    <div>
                      <span className="font-semibold text-sm block">{reg.teamName}</span>
                      {reg.notes && (
                        <span className="text-xs text-muted-foreground block max-w-xs truncate italic">
                          &ldquo;{reg.notes}&rdquo;
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {reg.tournamentName}
                    <span className="block text-xs text-muted-foreground" role="status">{reg.eligibility}</span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{reg.squadCount} players</TableCell>
                  <TableCell className="text-sm tabular-nums">PKR {Number(reg.registrationFee).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${reg.status === "approved" ? "bg-success/5 text-success border-success/20" : reg.status === "rejected" ? "bg-destructive/5 text-destructive border-destructive/20" : "bg-info/5 text-info border-info/20"}`}>
                      {reg.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                    ) : (
                      <div className="flex gap-2 justify-end">
                        {canEditRegistrationSquad(reg.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={saving}
                            onClick={() => openSquadEditor(reg)}
                          >
                            Edit squad
                          </Button>
                        )}
                        {canWithdrawRegistrationEntry(reg.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={withdrawing}
                            onClick={() => setWithdrawTarget(reg)}
                          >
                            Withdraw
                          </Button>
                        )}
                        {isPending && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-success hover:text-success hover:bg-success/10"
                              onClick={() => handleApprove(reg.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setRejectingId(reg.id)}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {registrations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-sm">
                  No registration requests received.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Reject Reason Dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(open) => !open && setRejectingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
            <DialogDescription>
              Please enter a reason for rejecting this team registration request.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="e.g. Squad size is smaller than the required limit, or unpaid registration fees."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectionReason.trim()}
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Squad Dialog (ENH-05-03 slice 4) */}
      <Dialog open={!!editingReg} onOpenChange={(open) => !open && !saving && setEditingReg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit registered squad</DialogTitle>
            <DialogDescription>
              {editingReg ? `${editingReg.teamName} — ${editingReg.tournamentName}: pick the players that will represent this team.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto py-2">
            {options === null ? (
              <div role="status" className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading players…
              </div>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active players are on this roster yet.</p>
            ) : (
              options.map((player) => {
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
                    onClick={() => toggleSquad(player.id)}
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
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingReg(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveSquad} disabled={saving || selected.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save squad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {withdrawTarget && (
        <WithdrawDialog
          teamName={withdrawTarget.teamName}
          tournamentName={withdrawTarget.tournamentName}
          saving={withdrawing}
          onConfirm={confirmWithdraw}
          onClose={() => setWithdrawTarget(null)}
        />
      )}
    </div>
  )
}
