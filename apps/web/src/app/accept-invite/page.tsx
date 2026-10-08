"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { acceptInvite, getInvitePreview } from "@/app/actions/users-invites"

interface InvitePreview {
  email: string
  role: string
  status: string
  tenantName: string
  teamName: string | null
  expired: boolean
}

export default function AcceptInvitePage() {
  const params = useSearchParams()
  const token = params.get("token") ?? ""
  const router = useRouter()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!token) {
      setLoaded(true)
      return
    }
    getInvitePreview(token)
      .then((p) => setPreview(p as InvitePreview | null))
      .catch(() => setPreview(null))
      .finally(() => setLoaded(true))
  }, [token])

  const accept = () =>
    startTransition(async () => {
      try {
        const res = await acceptInvite(token)
        toast.success(`You joined as ${res.role.replace("_", " ")}`)
        router.push("/dashboard")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to accept invitation")
      }
    })

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Checking invitation…</p>
      </div>
    )
  }

  if (!token || !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>This link is invalid or has already been used.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/sign-in">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const blocked =
    preview.expired || preview.status === "revoked" || preview.status === "expired" || preview.status === "accepted"

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join {preview.tenantName}</CardTitle>
          <CardDescription>
            You have been invited as <b>{preview.role.replace("_", " ")}</b>
            {preview.teamName ? ` for ${preview.teamName}` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Email:</span> {preview.email}</p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant="outline">{preview.status}</Badge>
            </p>
          </div>

          {preview.expired && <p className="text-sm text-destructive">This invitation has expired. Ask your league owner for a new one.</p>}
          {preview.status === "accepted" && <p className="text-sm text-muted-foreground">This invitation was already accepted.</p>}
          {preview.status === "revoked" && <p className="text-sm text-destructive">This invitation was revoked.</p>}

          {!blocked && (
            <div className="space-y-2">
              <Button asChild className="w-full">
                <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>
                  Sign in to accept
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/sign-up?redirect_url=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>
                  Create an account
                </Link>
              </Button>
              <Button
                className="w-full"
                disabled={isPending}
                onClick={accept}
              >
                {isPending ? "Accepting..." : "Accept Invitation"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Sign in or create an account with <b>{preview.email}</b>, then accept this invitation.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
