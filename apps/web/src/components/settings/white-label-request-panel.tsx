"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { requestWhiteLabel } from "@/app/actions/white-label"
import { Loader2, Palette, ArrowUpRight } from "lucide-react"

interface WhiteLabelRequestItem {
  id: string
  status: string
  customDomain: string | null
  hideBranding: boolean
  customAppName: string | null
  adminNotes: string | null
  createdAt: Date
}

export function WhiteLabelRequestPanel({
  plan,
  tenantId,
  requests,
}: {
  plan: string
  tenantId: string
  requests: WhiteLabelRequestItem[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [hideBranding, setHideBranding] = useState(false)
  const [customAppName, setCustomAppName] = useState("")
  const [customDomain, setCustomDomain] = useState("")
  const [reason, setReason] = useState("")
  const [dns, setDns] = useState<{ domain: string; expectedValue: string; status: string; expiresAt: string } | null>(null)
  const [dnsLoading, setDnsLoading] = useState(false)
  const canWhiteLabel = plan === "pro" || plan === "enterprise"
  const canDomain = plan === "enterprise"
  const hasPending = requests.some((request) => request.status === "pending")
  const approvedDomain = requests.find((request) => request.status === "approved" && request.customDomain)?.customDomain

  const requestDnsVerification = async () => {
    if (!approvedDomain) return
    setDnsLoading(true)
    try {
      const response = await fetch("/api/dns/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, domain: approvedDomain }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not start domain verification")
      setDns({ domain: approvedDomain, expectedValue: data.expectedValue, status: data.status, expiresAt: data.expiresAt })
      toast.success("DNS verification details are ready")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start domain verification")
    } finally {
      setDnsLoading(false)
    }
  }

  const checkDnsVerification = async () => {
    if (!approvedDomain) return
    setDnsLoading(true)
    try {
      const query = new URLSearchParams({ tenantId, domain: approvedDomain })
      const response = await fetch(`/api/dns/verify?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not check DNS")
      setDns({ domain: approvedDomain, expectedValue: data.expectedValue, status: data.status, expiresAt: data.expiresAt })
      toast[data.status === "verified" ? "success" : "info"](data.status === "verified" ? "Domain ownership verified" : "DNS record not found yet")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check DNS")
    } finally {
      setDnsLoading(false)
    }
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      try {
        await requestWhiteLabel({
          hideBranding,
          customAppName: customAppName.trim() || null,
          customDomain: customDomain.trim() || null,
          reason: reason.trim() || null,
        })
        toast.success("White-label request sent to the SSL team")
        setCustomAppName("")
        setCustomDomain("")
        setReason("")
        setHideBranding(false)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not submit request")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> White-label &amp; domain</CardTitle>
        <CardDescription>
          Request SSL branding removal or a custom league domain. Requests are reviewed by MTK; a domain is not activated until ownership and SSL are verified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!canWhiteLabel ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            White-label features are included with Pro and Enterprise.
            <Link className="ml-2 inline-flex items-center font-medium text-primary" href="/dashboard/settings/billing">
              View plans <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <input id="hideSslBranding" type="checkbox" checked={hideBranding} onChange={(event) => setHideBranding(event.target.checked)} className="mt-1" />
              <div>
                <Label htmlFor="hideSslBranding">Remove SSL branding</Label>
                <p className="text-xs text-muted-foreground">Available with Pro or Enterprise; takes effect after approval.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whiteLabelAppName">League app name (optional)</Label>
              <Input id="whiteLabelAppName" value={customAppName} onChange={(event) => setCustomAppName(event.target.value)} maxLength={120} placeholder="Your league name" />
            </div>
            {canDomain && (
              <div className="space-y-2">
                <Label htmlFor="whiteLabelDomain">Custom domain (Enterprise)</Label>
                <Input id="whiteLabelDomain" value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} maxLength={253} placeholder="scores.example.com" />
                <p className="text-xs text-muted-foreground">Enter a hostname only. MTK will provide the DNS verification record after review.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="whiteLabelReason">Note for MTK (optional)</Label>
              <Input id="whiteLabelReason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Tell us how you plan to use this setup" />
            </div>
            <Button type="submit" disabled={isPending || hasPending || (!hideBranding && !customAppName.trim() && !customDomain.trim())}>
              {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting</> : hasPending ? "Request pending review" : "Submit white-label request"}
            </Button>
          </form>
        )}

        {requests.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Request history</h3>
            {requests.map((request) => (
              <div key={request.id} className="rounded-lg bg-muted/40 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="capitalize font-medium">{request.status}</span>
                  <time className="text-xs text-muted-foreground">{new Date(request.createdAt).toLocaleDateString()}</time>
                </div>
                {(request.customDomain || request.customAppName) && <p className="mt-1 text-muted-foreground">{request.customDomain || request.customAppName}</p>}
                {request.adminNotes && <p className="mt-1 text-muted-foreground">MTK: {request.adminNotes}</p>}
              </div>
            ))}
          </div>
        )}
        {approvedDomain && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div>
              <h3 className="font-semibold">Connect {approvedDomain}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Add the TXT record below to prove domain ownership. SSL will be enabled after verification and certificate provisioning.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={requestDnsVerification} disabled={dnsLoading}>
                {dnsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Show DNS record
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={checkDnsVerification} disabled={dnsLoading}>Check DNS</Button>
            </div>
            {dns && (
              <dl className="grid gap-2 rounded-md bg-background p-3 text-sm sm:grid-cols-[90px_1fr]">
                <dt className="font-medium">Type</dt><dd>TXT</dd>
                <dt className="font-medium">Host</dt><dd className="break-all font-mono">_ssl-verify.{dns.domain}</dd>
                <dt className="font-medium">Value</dt><dd className="break-all font-mono">{dns.expectedValue}</dd>
                <dt className="font-medium">Status</dt><dd className="capitalize">{dns.status}</dd>
              </dl>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
