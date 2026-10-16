"use client"

import React, { useEffect, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser, UserButton } from "@clerk/nextjs"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { acceptInvite, getInvitePreview } from "@/app/actions/users-invites"
import { InvitedEmailVerification } from "@/components/users/invited-email-verification"

type Preview = NonNullable<Awaited<ReturnType<typeof getInvitePreview>>>

export default function AcceptInvitePage() {
  const token = useSearchParams().get("token") ?? ""
  const router = useRouter()
  const { user, isLoaded: identityLoaded, isSignedIn } = useUser()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [isPending, startTransition] = useTransition()
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setPreview(null)
    setError("")
    if (!token) { setLoaded(true); return }
    getInvitePreview(token).then(value => { if (!cancelled) setPreview(value) })
      .catch(() => { if (!cancelled) setError("Unable to check this invitation. Retry when access is available.") })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [token, user?.id, reloadKey])

  const address = preview?.recipientEmail ? user?.emailAddresses.find(item =>
    item.emailAddress.trim().toLowerCase() === preview.recipientEmail!.trim().toLowerCase()) : null
  const verified = address?.verification.status === "verified"
  const returnPath = `/accept-invite?token=${encodeURIComponent(token)}`
  const accept = () => startTransition(async () => {
    try {
      const result = await acceptInvite(token)
      toast.success(`Invitation accepted as ${result.role.replaceAll("_", " ")}. Match assignments are separate.`)
      // Do not claim acceptance selects the invited league: host/default routing
      // is independent and the account may have other primary memberships.
      setPreview(null)
      router.replace("/dashboard")
      router.refresh()
    } catch {
      setError("Invitation could not be accepted. Recheck it; your verification, membership, inviter or team access may have changed.")
    }
  })

  return <div className="min-h-screen flex items-center justify-center p-4">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{!loaded || !identityLoaded ? "Checking invitation…" : preview ? `Join ${preview.tenantName}` : "Invitation unavailable"}</CardTitle>
        <CardDescription>{preview ? `Invited as ${preview.role.replaceAll("_", " ")}${preview.teamName ? ` for ${preview.teamName}` : ""}.` : "Expired, revoked or already-used links cannot grant membership."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loaded && <Button variant="outline" disabled={isPending} onClick={() => setReloadKey(key => key + 1)}>Recheck invitation</Button>}
        {preview && identityLoaded && <>
          <p className="text-sm">Invited mailbox: <b>{preview.recipientHint}</b></p>
          {preview.membershipExpiresAt && <p className="rounded-md border px-3 py-2 text-sm" role="note">This membership is bounded: access in {preview.tenantName} expires on <b>{new Date(preview.membershipExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</b>. Extending it afterwards requires the league owner.</p>}
          {!isSignedIn ? <div className="space-y-2">
            <Button asChild className="w-full"><Link href={`/sign-in?redirect_url=${encodeURIComponent(returnPath)}`}>Sign in to verify and accept</Link></Button>
            <Button asChild variant="outline" className="w-full"><Link href={`/sign-up?redirect_url=${encodeURIComponent(returnPath)}`}>Create an account</Link></Button>
          </div> : <>
            <UserButton />
            {!address ? <p role="alert">This account does not contain the invited email. Switch accounts using the account menu; do not accept on behalf of another person.</p> : <>
              {!verified && preview.recipientEmail && <InvitedEmailVerification key={`${user?.id}/${address.id}`} email={preview.recipientEmail} onVerified={() => setReloadKey(key => key + 1)} />}
              {verified && <p className="text-sm">Invited email verified. League authority will be rechecked when you accept.</p>}
              <Button className="w-full" disabled={isPending || !verified} onClick={accept}>{isPending ? "Accepting…" : "Accept invitation"}</Button>
            </>}
          </>}
          <p className="text-xs text-muted-foreground">Email verification proves identity, not permission. Suspended memberships cannot be restored through an invitation. Scorers also need a match assignment.</p>
        </>}
      </CardContent>
    </Card>
  </div>
}
