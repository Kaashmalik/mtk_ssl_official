"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Crown } from "lucide-react"
import { acceptOwnershipTransfer, cancelOwnershipTransfer } from "@/app/actions/ownership"

/**
 * Recipient-facing handover request. This is the second party's consent: the
 * league only changes hands when the named recipient accepts it here, on their
 * own authenticated session. Declining cancels the offer and changes nothing.
 */
export function OwnershipTransferRequest({ tenantId, transferId, expectedVersion, ownerLabel, expiresAt }: {
  tenantId: string
  transferId: string
  expectedVersion: number
  ownerLabel: string
  expiresAt: Date | string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")

  const resolve = async (action: "accept" | "decline") => {
    if (busy) return
    setBusy(true)
    setNotice(action === "accept" ? "Accepting ownership…" : "Declining the offer…")
    try {
      if (action === "accept") {
        await acceptOwnershipTransfer({ tenantId, transferId, expectedVersion })
        toast.success("You are now the league owner")
      } else {
        await cancelOwnershipTransfer({ tenantId, transferId, expectedVersion })
        toast.success("Ownership offer declined")
      }
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resolve the offer. Reload and try again."
      setNotice(message)
      toast.error(message)
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Crown className="h-5 w-5" aria-hidden="true" />
        <h2 className="font-semibold">Ownership of this league has been offered to you</h2>
        <Badge variant="outline">Action needed</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {ownerLabel} wants to hand you ownership of this league. Accepting makes you the recorded owner and demotes
        them to a normal league role. Nothing changes unless you accept. The offer expires{" "}
        {new Date(expiresAt).toLocaleString()}.
      </p>
      <p role="status" aria-live="polite" className="text-sm">{notice}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void resolve("accept")}>{busy ? "Working…" : "Accept ownership"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void resolve("decline")}>Decline</Button>
      </div>
    </div>
  )
}
