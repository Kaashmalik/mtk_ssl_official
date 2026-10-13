"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mtk/ui/components/ui/dialog"
import { Crown } from "lucide-react"
import { initiateOwnershipTransfer, cancelOwnershipTransfer } from "@/app/actions/ownership"

interface Member {
  id: string
  membershipId: string
  email: string
  displayName: string | null
  role: string
  status: "active" | "suspended"
  accountActive: boolean
  protectedAccess: boolean
  version: number
}

interface PendingTransfer {
  id: string
  status: string
  demotedRole: string
  expiresAt: Date | string
  version: number
  fromUserId: string
  toUserId: string
  viewer: "initiator" | "recipient"
}

const DEMOTED_ROLE_LABELS: Record<string, string> = {
  team_manager: "Team Manager",
  coach: "Coach",
  scorer: "Scorer",
  player: "Player",
  fan: "Fan",
}

/**
 * Owner-facing ownership handover. Only the recorded owner can offer ownership,
 * and the offer is inert until the selected member accepts it on their own
 * session, so a single click here can never move the league.
 */
export function OwnershipTransferPanel({ tenantId, currentUserId, members, initialTransfer }: {
  tenantId: string
  currentUserId: string
  members: Member[]
  initialTransfer: PendingTransfer | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState<PendingTransfer | null>(
    initialTransfer && initialTransfer.viewer === "initiator" ? initialTransfer : null,
  )
  const [recipient, setRecipient] = useState("")
  const [demotedRole, setDemotedRole] = useState("team_manager")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")

  // Only active, non-owner, non-platform members can receive ownership.
  const candidates = members.filter(member => member.id !== currentUserId && member.status === "active"
    && member.accountActive && !member.protectedAccess
    && !["league_owner", "super_admin"].includes(member.role))
  const recipientMember = candidates.find(member => member.membershipId === recipient)

  const initiate = async () => {
    if (busy || !recipientMember) return
    setBusy(true)
    setNotice("Offering ownership…")
    try {
      const result = await initiateOwnershipTransfer({ tenantId, recipientMembershipId: recipientMember.membershipId, demotedRole: demotedRole as "team_manager" })
      setPending({ id: result.transferId, status: "pending", demotedRole, expiresAt: result.expiresAt,
        version: 0, fromUserId: currentUserId, toUserId: recipientMember.id, viewer: "initiator" })
      setConfirming(false)
      setRecipient("")
      setNotice(`${recipientMember.displayName || recipientMember.email} must accept before ownership moves.`)
      toast.success("Ownership offer sent — awaiting acceptance")
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not offer ownership. Reload and try again."
      setNotice(message)
      toast.error(message)
      router.refresh()
    } finally { setBusy(false) }
  }

  const cancel = async () => {
    if (busy || !pending) return
    setBusy(true)
    setNotice("Cancelling the ownership offer…")
    try {
      await cancelOwnershipTransfer({ tenantId, transferId: pending.id, expectedVersion: pending.version })
      setPending(null)
      setNotice("Ownership offer cancelled. Nothing changed.")
      toast.success("Ownership offer cancelled")
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not cancel the offer. Reload and try again."
      setNotice(message)
      toast.error(message)
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Crown className="h-5 w-5" /> Ownership transfer</CardTitle>
        <CardDescription>
          Hand this league to another active member. The transfer only completes when they accept it from their own
          account, and the league always keeps exactly one owner — you keep a normal league role you choose here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>
        {pending ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <p className="text-sm font-medium">
              Offer pending for {members.find(m => m.id === pending.toUserId)?.displayName || members.find(m => m.id === pending.toUserId)?.email || "the selected member"}
            </p>
            <p className="text-xs text-muted-foreground">
              They must accept before ownership moves. Expires {new Date(pending.expiresAt).toLocaleString()}.
              Your role after acceptance: {DEMOTED_ROLE_LABELS[pending.demotedRole] ?? pending.demotedRole}.
            </p>
            <Badge variant="outline">Awaiting recipient acceptance</Badge>
            <div>
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void cancel()}>
                {busy ? "Cancelling…" : "Cancel offer"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ownership-recipient">New owner</Label>
                <Select disabled={busy} value={recipient} onValueChange={setRecipient}>
                  <SelectTrigger id="ownership-recipient" className="mt-1.5 min-h-11" aria-label="Member to receive ownership"><SelectValue placeholder="Choose an active member" /></SelectTrigger>
                  <SelectContent>
                    {candidates.map(member => (
                      <SelectItem key={member.membershipId} value={member.membershipId}>
                        {member.displayName || member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ownership-role">Your role afterwards</Label>
                <Select disabled={busy} value={demotedRole} onValueChange={setDemotedRole}>
                  <SelectTrigger id="ownership-role" className="mt-1.5 min-h-11" aria-label="Your league role after the transfer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEMOTED_ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Suspended, platform and owner members cannot receive ownership, and you cannot offer it to yourself.
              Ownership never moves until the recipient accepts.
            </p>
            <Button disabled={busy || !recipientMember} onClick={() => setConfirming(true)}>
              Offer ownership
            </Button>
          </>
        )}
      </CardContent>
      <Dialog open={confirming} onOpenChange={open => { if (!open && !busy) setConfirming(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer ownership of this league?</DialogTitle>
            <DialogDescription>
              This offers ownership to {recipientMember?.displayName || recipientMember?.email} in this league only.
              Nothing changes until they accept. On acceptance you become {DEMOTED_ROLE_LABELS[demotedRole]} and they
              become the recorded owner. You can cancel the offer any time before they accept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void initiate()}>{busy ? "Offering…" : "Send ownership offer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
