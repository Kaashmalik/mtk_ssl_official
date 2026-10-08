"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"

export default function ImpersonationCallback() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    fetch(`/api/impersonation/session?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to start impersonation")
        if (data.target?.email) {
          window.sessionStorage.setItem("ssl_impersonating_email", data.target.email)
        }
        router.replace("/dashboard")
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to start impersonation"))
  }, [token, router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-lg font-semibold text-destructive">Impersonation failed</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => router.push("/")}>Go Home</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Starting impersonation session…</p>
    </div>
  )
}