"use client"

import React, { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateMemberExpiry } from "@/app/actions/users"
import { Button } from "@mtk/ui/components/ui/button"

export function MemberExpiryForm({ tenantId, membershipId, version, expiresAt }: {
  tenantId: string; membershipId: string; version: number; expiresAt: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState("")
  const [clear, setClear] = useState(false)
  const [notice, setNotice] = useState("")
  const [pending, startTransition] = useTransition()
  return <form className="rounded-lg border p-4 space-y-3" onSubmit={event => {
    event.preventDefault()
    if (pending) return
    const parsed = value ? new Date(value) : null
    if (!clear && (!parsed || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now())) {
      setNotice("Choose a future expiry, or explicitly remove the expiry bound.")
      return
    }
    startTransition(async () => {
      try {
        const result = await updateMemberExpiry({ tenantId, membershipId, expectedVersion: version,
          expiresAt: clear ? null : parsed!.toISOString() })
        setNotice(result.member.expiresAt ? "Expiry saved. Reloaded membership authority applies to future requests." : "Expiry removed. Suspension and role restrictions still apply.")
        router.refresh()
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Expiry was not saved. Reload and try again.")
      }
    })
  }}>
    <h2 className="font-semibold">Edit membership expiry</h2>
    <p className="text-sm">Current bound: {expiresAt ?? "No expiry"}. This changes this league only. It never changes the global account or clears suspension.</p>
    <label className="block text-sm">Future expiry (your device timezone)
      <input type="datetime-local" className="block rounded border bg-background p-2 min-h-11" value={value}
        disabled={pending || clear} required={!clear} onChange={event => setValue(event.target.value)} />
    </label>
    <label className="flex items-center gap-2 text-sm min-h-11">
      <input type="checkbox" checked={clear} disabled={pending} onChange={event => setClear(event.target.checked)} />
      Explicitly remove the expiry bound
    </label>
    <p role="status" aria-live="polite" className="text-sm">{notice}</p>
    <Button type="submit" disabled={pending}>{pending ? "Saving expiry…" : "Save expiry"}</Button>
  </form>
}
