"use client"

import React, { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"

/** Codes are sent/checked only by Clerk; never forwarded to application actions. */
export function InvitedEmailVerification({ email, onVerified }: { email: string; onVerified: () => void }) {
  const { user } = useUser()
  const address = user?.emailAddresses.find(item => item.emailAddress.trim().toLowerCase() === email.trim().toLowerCase())
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState("")
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const send = async () => {
    if (!address || busy || cooldown > 0) return
    setBusy(true)
    setCode("")
    try {
      await address.prepareVerification({ strategy: "email_code" })
      setSent(true)
      setMessage("Verification code requested from the sign-in provider. Check the invited mailbox.")
    } catch {
      setMessage("Could not request a code. The provider may be unavailable or rate-limiting requests. Try again later.")
    } finally {
      // UX throttle only. Clerk's server-side verification/abuse limits enforce security.
      setCooldown(60)
      setBusy(false)
    }
  }
  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!address || !code.trim() || busy) return
    setBusy(true)
    try {
      const result = await address.attemptVerification({ code: code.trim() })
      if (result.verification?.status !== "verified") {
        setMessage("Verification is incomplete. Request a new code if necessary.")
        return
      }
      await user?.reload()
      setCode("")
      setMessage("Email verified. Accepting the invitation is a separate authorized step.")
      onVerified()
    } catch {
      setCode("")
      setMessage("Could not verify this code. It may be invalid, expired or blocked by provider limits.")
    } finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label="Verify invited email">
    <p className="text-sm">Verify <b>{email}</b> through your sign-in provider. Verification alone does not grant league access.</p>
    <Button variant="outline" disabled={busy || !address || cooldown > 0} onClick={() => void send()}>
      {cooldown > 0 ? `Request again in ${cooldown}s` : sent ? "Request a new code" : "Request verification code"}
    </Button>
    {sent && <form onSubmit={verify} className="space-y-2">
      <Label htmlFor="invited-email-code">Email verification code</Label>
      <Input id="invited-email-code" autoComplete="one-time-code" inputMode="numeric" maxLength={32} value={code}
        disabled={busy} onChange={event => setCode(event.target.value)} />
      <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Verify email"}</Button>
    </form>}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </section>
}
