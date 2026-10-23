"use client"

import React from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mtk/ui/components/ui/dialog"

/**
 * ENH-05-03 slice 5: the shared confirmation for taking a team's own
 * registration OUT of review. The description names the truth: the entry
 * stays as history (nothing is deleted), the squad keeps its members, and —
 * while the registration window is open — a NEW registration can be
 * submitted afterwards. The service re-checks the transition server-side.
 */
export interface WithdrawDialogProps {
  teamName: string
  tournamentName: string
  saving: boolean
  onConfirm: () => void
  onClose: () => void
}

export function WithdrawDialog({ teamName, tournamentName, saving, onConfirm, onClose }: WithdrawDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw registration</DialogTitle>
          <DialogDescription>
            {teamName} — {tournamentName}: the entry stays in the record and the squad keeps its members.
            While registration is open, a new registration can be submitted afterwards.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={saving}>Confirm withdrawal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
