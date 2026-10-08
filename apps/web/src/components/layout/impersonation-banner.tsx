"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"

/**
 * Sticky banner shown while a super admin is impersonating a user.
 * The auth cookie is HttpOnly, so the callback page mirrors the target email
 * into sessionStorage for display purposes only.
 */
export function ImpersonationBanner() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    setEmail(window.sessionStorage.getItem("ssl_impersonating_email"))
  }, [])

  if (!email) return null

  return (
    <div className="bg-amber-500 text-black px-4 py-2 text-sm flex items-center justify-between gap-3">
      <span>
        Viewing as <strong>{email}</strong> — actions are audited.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="bg-black/10 border-black/20"
        onClick={async () => {
          await fetch("/api/impersonation/exit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })
          window.sessionStorage.removeItem("ssl_impersonating_email")
          setEmail(null)
          router.push("/")
          router.refresh()
        }}
      >
        Exit Impersonation
      </Button>
    </div>
  )
}