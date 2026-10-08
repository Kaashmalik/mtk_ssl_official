"use client"

import { useEffect, useState } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { toast } from "sonner"
import { OtpInput } from "./otp-input"

export function OtpVerification() {
  const [identifier, setIdentifier] = useState("")
  const [channel, setChannel] = useState<"whatsapp" | "sms" | "email">("email")
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const send = async () => {
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, channel, purpose: "registration" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send")
      setSent(true)
      setCooldown(60)
      toast.success(data.mock ? "OTP sent (mock mode — check server logs)" : "OTP sent")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send OTP")
    }
  }

  const verify = async (code: string) => {
    setVerifying(true)
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, code, purpose: "registration" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Verification failed")
      setVerified(true)
      toast.success("Verified successfully")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed")
    } finally {
      setVerifying(false)
    }
  }

  if (verified) {
    return <p className="text-center text-green-600 font-semibold py-8">Verified. You can continue to your dashboard.</p>
  }

  return (
    <div className="space-y-4 max-w-md mx-auto">
      {!sent ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="otp-identifier">Email or phone</Label>
            <Input id="otp-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="+923001234567 or email@example.com" />
          </div>
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={!identifier} onClick={send}>Send Code</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground text-center">Enter the 6-digit code sent to <b>{identifier}</b> via {channel}.</p>
          <OtpInput onComplete={verify} disabled={verifying} />
          <div className="text-center">
            <button
              type="button"
              className="text-sm text-primary underline disabled:text-muted-foreground"
              disabled={cooldown > 0}
              onClick={send}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Didn&apos;t receive it?{" "}
            <button type="button" className="underline" onClick={() => setSent(false)}>Try a different channel</button>
          </p>
        </>
      )}
    </div>
  )
}
