"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Separator } from "@mtk/ui/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { toast } from "sonner"
import {
  Check, Crown, Star, ArrowUpRight, Clock, XCircle, CheckCircle2, Loader2,
  Building2, Wallet, Landmark, QrCode, Copy, CheckCheck, Phone, ChevronDown, ChevronUp,
} from "lucide-react"
import { UpgradePlanModal } from "@/components/settings/upgrade-plan-modal"
import type { Tenant } from "@mtk/database"
import { PLAN_PRICES, PLAN_LIMITS } from "@mtk/database/lib/plan-limits"
import { PAYMENT_CONFIG } from "@/lib/payment-config"

/**
 * Standardized plan configuration — matches DB enum and marketing page.
 */
const PLANS = [
  {
    key: "free",
    name: "Free",
    price: PLAN_PRICES.free,
    displayPrice: `Rs ${PLAN_PRICES.free.toLocaleString()}`,
    period: "forever",
    description: "Perfect for small local leagues",
    features: [
      `Up to ${PLAN_LIMITS.free.maxTeams} teams`,
      `Up to ${PLAN_LIMITS.free.maxPlayers} players`,
      "Basic scoring",
      "Points table",
      "Public league page"
    ],
    maxTeams: PLAN_LIMITS.free.maxTeams,
    maxPlayers: PLAN_LIMITS.free.maxPlayers,
    whiteLabel: PLAN_LIMITS.free.whiteLabel,
    customDomain: PLAN_LIMITS.free.customDomain,
    liveStreaming: PLAN_LIMITS.free.liveStreaming,
    popular: false,
  },
  {
    key: "starter",
    name: "Starter",
    price: PLAN_PRICES.starter,
    displayPrice: `Rs ${PLAN_PRICES.starter.toLocaleString()}`,
    period: "per league",
    description: "For growing leagues",
    features: [
      `Up to ${PLAN_LIMITS.starter.maxTeams} teams`,
      `Up to ${PLAN_LIMITS.starter.maxPlayers} players`,
      "Advanced scoring",
      "Player statistics",
      "Custom branding",
      "Payment collection",
    ],
    maxTeams: PLAN_LIMITS.starter.maxTeams,
    maxPlayers: PLAN_LIMITS.starter.maxPlayers,
    whiteLabel: PLAN_LIMITS.starter.whiteLabel,
    customDomain: PLAN_LIMITS.starter.customDomain,
    liveStreaming: PLAN_LIMITS.starter.liveStreaming,
    popular: false,
  },
  {
    key: "pro",
    name: "Pro",
    price: PLAN_PRICES.pro,
    displayPrice: `Rs ${PLAN_PRICES.pro.toLocaleString()}`,
    period: "per league",
    description: "For professional leagues",
    features: [
      "Unlimited teams & players",
      "Live streaming",
      "Fantasy cricket (roadmap)",
      "White-label option",
      "Priority support",
      "Advanced analytics",
      "API access",
    ],
    maxTeams: PLAN_LIMITS.pro.maxTeams,
    maxPlayers: PLAN_LIMITS.pro.maxPlayers,
    whiteLabel: PLAN_LIMITS.pro.whiteLabel,
    customDomain: PLAN_LIMITS.pro.customDomain,
    liveStreaming: PLAN_LIMITS.pro.liveStreaming,
    popular: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: PLAN_PRICES.enterprise,
    displayPrice: `Rs ${PLAN_PRICES.enterprise.toLocaleString()}`,
    period: "per league",
    description: "For major tournaments & boards",
    features: [
      "Everything in Pro",
      "White-label + custom domain",
      "Dedicated support",
      "SLA guarantee",
      "Custom integrations",
      "Training & onboarding",
    ],
    maxTeams: PLAN_LIMITS.enterprise.maxTeams,
    maxPlayers: PLAN_LIMITS.enterprise.maxPlayers,
    whiteLabel: PLAN_LIMITS.enterprise.whiteLabel,
    customDomain: PLAN_LIMITS.enterprise.customDomain,
    liveStreaming: PLAN_LIMITS.enterprise.liveStreaming,
    popular: false,
  },
] as const

type PlanKey = (typeof PLANS)[number]["key"]

interface SubscriptionRequest {
  id: string
  requestedPlan: string
  currentPlan: string
  amount: string
  paymentMethod: string
  status: string
  createdAt: string
  expiresAt: string
  adminNotes: string | null
  transactionReference: string
}

interface BillingPageClientProps {
  tenant: Tenant
  clerkUserId: string
}

export function BillingPageClient({ tenant, clerkUserId: _clerkUserId }: BillingPageClientProps) {
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null)
  const [cardPlan, setCardPlan] = useState<PlanKey>("pro")
  const [cardPeriod, setCardPeriod] = useState<"monthly" | "annual">("monthly")
  const [stripeLoading, setStripeLoading] = useState(false)
  const [requests, setRequests] = useState<SubscriptionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [bankExpanded, setBankExpanded] = useState(true)
  const [mobileExpanded, setMobileExpanded] = useState(true)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const currentPlan = tenant.plan as PlanKey

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions/request")
      if (res.ok) {
        const data = await res.json()
        setRequests(data.requests || [])
      }
    } catch (err) {
      console.error("Failed to fetch subscription requests:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const handleUpgradeClick = (planKey: PlanKey) => {
    setSelectedPlan(planKey)
    setUpgradeModalOpen(true)
  }

  const startStripeCheckout = async () => {
    setStripeLoading(true)
    try {
      const res = await fetch("/api/billing/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: cardPlan, period: cardPeriod }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Card payments are unavailable")
      window.location.href = data.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start checkout")
      setStripeLoading(false)
    }
  }

  const hasPendingRequest = requests.some((r) => r.status === "pending")

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copyToClipboard(text, field)}
      className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-muted transition-colors"
      title="Copy to clipboard"
    >
      {copiedField === field ? (
        <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-300 bg-yellow-50">
            <Clock className="h-3 w-3" />
            Pending Review
          </Badge>
        )
      case "approved":
        return (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50">
            <CheckCircle2 className="h-3 w-3" />
            Approved
          </Badge>
        )
      case "rejected":
        return (
          <Badge variant="outline" className="gap-1 text-red-600 border-red-300 bg-red-50">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        )
      case "expired":
        return (
          <Badge variant="outline" className="gap-1 text-gray-600 border-gray-300 bg-gray-50">
            Expired
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-8">
      {/* ─── Current Plan Summary ─────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent h-1" />
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <Crown className="h-5 w-5" />
                </div>
                Current Plan
              </CardTitle>
              <CardDescription className="mt-1">
                Your league &ldquo;{tenant.name}&rdquo; is on the{" "}
                <span className="font-semibold text-foreground capitalize">{currentPlan}</span> plan.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant="secondary" className="text-sm capitalize h-8 px-3">
                {currentPlan}
              </Badge>
              {currentPlan !== "free" && (
                <Button size="sm" onClick={() => { setSelectedPlan(currentPlan); setUpgradeModalOpen(true) }}>
                  Renew Now
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* International tenants can pay by card via Stripe Checkout when configured. */}
          <div className="mb-4 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Pay by card (international)</p>
              <p className="text-xs text-muted-foreground">
                Visa / Mastercard via Stripe. Annual billing saves 2 months.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={cardPlan} onValueChange={(v) => setCardPlan(v as PlanKey)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.filter((p) => p.key !== "free").map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={cardPeriod} onValueChange={(v) => setCardPeriod(v as "monthly" | "annual")}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" disabled={stripeLoading} onClick={startStripeCheckout}>
                {stripeLoading ? "Opening..." : "Pay with card"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Max Teams", value: PLANS.find((p) => p.key === currentPlan)?.maxTeams },
              { label: "Max Players", value: PLANS.find((p) => p.key === currentPlan)?.maxPlayers },
              { label: "White-Label", value: PLANS.find((p) => p.key === currentPlan)?.whiteLabel },
              { label: "Live Streaming", value: PLANS.find((p) => p.key === currentPlan)?.liveStreaming },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border bg-muted/30 p-4 text-center">
                <div className="text-2xl font-bold tracking-tight">
                  {typeof stat.value === "number" && stat.value === Infinity ? "∞" : stat.value ? "✓" : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Payment Accounts ──────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-transparent h-1" />
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Payment Accounts</CardTitle>
              <CardDescription>
                Transfer the plan amount to any of the accounts below, then upload your receipt.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bank Account */}
          <div className="rounded-xl border overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              onClick={() => setBankExpanded(!bankExpanded)}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm">{PAYMENT_CONFIG.bankName}</div>
                  <div className="text-xs text-muted-foreground">Bank Transfer — {PAYMENT_CONFIG.bankBranch}</div>
                </div>
              </div>
              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                Recommended
              </Badge>
            </button>
            {bankExpanded && (
              <div className="border-t bg-muted/20 px-4 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Title</div>
                    <div className="font-mono text-sm font-semibold flex items-center">
                      {PAYMENT_CONFIG.bankTitle}
                      <CopyButton text={PAYMENT_CONFIG.bankTitle} field="bank_title" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Number</div>
                    <div className="font-mono text-sm font-semibold flex items-center">
                      {PAYMENT_CONFIG.bankAccount}
                      <CopyButton text={PAYMENT_CONFIG.bankAccount} field="bank_acct" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">IBAN</div>
                    <div className="font-mono text-sm font-semibold flex items-center">
                      {PAYMENT_CONFIG.bankIban}
                      <CopyButton text={PAYMENT_CONFIG.bankIban} field="bank_iban" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Branch</div>
                    <div className="text-sm font-medium text-foreground">{PAYMENT_CONFIG.bankBranch}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Wallets */}
          <div className="rounded-xl border overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              onClick={() => setMobileExpanded(!mobileExpanded)}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                  <Phone className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm">Mobile Wallets</div>
                  <div className="text-xs text-muted-foreground">JazzCash, EasyPaisa, Raast</div>
                </div>
              </div>
              {mobileExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {mobileExpanded && (
              <div className="border-t bg-muted/20 px-4 py-4 space-y-3">
                {/* JazzCash */}
                <div className="rounded-lg border bg-white p-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-100 text-red-600 text-xs font-bold">
                      JC
                    </div>
                    <div className="text-sm font-semibold">JazzCash</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Account Name</div>
                      <div className="font-mono text-sm font-medium flex items-center">
                        {PAYMENT_CONFIG.jazzcashName}
                        <CopyButton text={PAYMENT_CONFIG.jazzcashName} field="jc_name" />
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Number</div>
                      <div className="font-mono text-sm font-medium flex items-center">
                        {PAYMENT_CONFIG.jazzcashNumber}
                        <CopyButton text={PAYMENT_CONFIG.jazzcashNumber} field="jc_number" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* EasyPaisa */}
                <div className="rounded-lg border bg-white p-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-100 text-green-700 text-xs font-bold">
                      EP
                    </div>
                    <div className="text-sm font-semibold">EasyPaisa</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Account Name</div>
                      <div className="font-mono text-sm font-medium flex items-center">
                        {PAYMENT_CONFIG.easypaisaName}
                        <CopyButton text={PAYMENT_CONFIG.easypaisaName} field="ep_name" />
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Number</div>
                      <div className="font-mono text-sm font-medium flex items-center">
                        {PAYMENT_CONFIG.easypaisaNumber}
                        <CopyButton text={PAYMENT_CONFIG.easypaisaNumber} field="ep_number" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Raast */}
                <div className="rounded-lg border bg-white p-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-100 text-teal-700 text-xs font-bold">
                      R
                    </div>
                    <div className="text-sm font-semibold">Raast</div>
                    <Badge variant="outline" className="text-[10px] h-5 bg-teal-50 text-teal-700 border-teal-200">
                      Instant
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">Raast ID (CNIC-linked)</div>
                    <div className="font-mono text-sm font-medium flex items-center">
                      {PAYMENT_CONFIG.raastId}
                      <CopyButton text={PAYMENT_CONFIG.raastId} field="raast_id" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Info banner */}
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800 space-y-2">
            <div className="font-medium flex items-center gap-2">
              <Landmark className="h-4 w-4" />
              How to pay
            </div>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>Transfer the plan amount to any account above</li>
              <li>Take a screenshot of the payment receipt</li>
              <li>Click <strong>&ldquo;Upgrade&rdquo;</strong> on any plan below and upload the screenshot</li>
              <li>Enter your transaction reference number and submit</li>
            </ol>
            <p className="text-blue-600 text-xs mt-2">
              ⏱ Your request will be reviewed within 24–48 hours. You&apos;ll get a confirmation on your billing page.
            </p>
            <p className="text-blue-700 text-xs">
              Questions about payment? Message MTK on WhatsApp at{" "}
              <a className="font-semibold underline" href="https://wa.me/923038111297" target="_blank" rel="noreferrer">03038111297</a>.
              Send your league name and plan; SSL will activate paid features only after payment verification.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Available Plans ───────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500" />
          Upgrade Your Plan
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.filter((p) => p.key !== "free").map((plan) => {
            const isCurrentPlan = plan.key === currentPlan
            return (
              <Card
                key={plan.key}
                className={`relative flex flex-col transition-all hover:shadow-md ${
                  plan.popular
                    ? "border-2 border-emerald-500 shadow-lg shadow-emerald-500/10"
                    : "hover:border-primary/30"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-4 py-1 rounded-full text-xs font-semibold flex items-center gap-1 shadow-lg">
                      <Star className="w-3 h-3 fill-current" />
                      Most Popular
                    </span>
                  </div>
                )}
                <CardHeader className="pb-0">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription className="text-sm">{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="mb-4">
                    <span className="text-3xl font-bold tracking-tight">{plan.displayPrice}</span>
                    {(plan.period as string) !== "forever" && (
                      <span className="text-sm text-muted-foreground ml-1">/{plan.period}</span>
                    )}
                  </div>
                  <Separator className="mb-4" />
                  <ul className="space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0 mt-0">
                          <Check className="h-3 w-3" />
                        </div>
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="pt-2">
                  <Button
                    className="w-full"
                    size="lg"
                    variant={isCurrentPlan ? "outline" : plan.popular ? "default" : "outline"}
                    disabled={isCurrentPlan || hasPendingRequest}
                    onClick={() => handleUpgradeClick(plan.key as PlanKey)}
                  >
                    {isCurrentPlan ? (
                      <>
                        <CheckCheck className="h-4 w-4 mr-2" />
                        Current Plan
                      </>
                    ) : hasPendingRequest ? (
                      <>
                        <Clock className="h-4 w-4 mr-2" />
                        Request Pending
                      </>
                    ) : (
                      <>
                        Upgrade
                        <ArrowUpRight className="h-4 w-4 ml-1.5" />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </div>

      {/* ─── Payment Request History ──────────────────────────────── */}
      <div>
        <Separator className="mb-6" />
        <h2 className="text-xl font-semibold mb-4">Payment Requests</h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto mb-3">
                <QrCode className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No payment requests yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Upgrade your plan above and upload a receipt to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <Card key={req.id} className="overflow-hidden">
                <div className={`h-0.5 ${
                  req.status === "approved" ? "bg-emerald-500" :
                  req.status === "pending" ? "bg-yellow-400" :
                  req.status === "rejected" ? "bg-red-400" : "bg-gray-300"
                }`} />
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold capitalize text-sm">
                          {req.requestedPlan}
                        </span>
                        {statusBadge(req.status)}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <span className="font-medium text-foreground">Rs {Number(req.amount).toLocaleString()}</span>
                        <span className="text-muted-foreground">&middot;</span>
                        <span className="capitalize">{req.paymentMethod.replace("_", " ")}</span>
                        <span className="text-muted-foreground">&middot;</span>
                        <span className="font-mono text-xs">Ref: {req.transactionReference}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Submitted {new Date(req.createdAt).toLocaleDateString()} at{" "}
                        {new Date(req.createdAt).toLocaleTimeString()}
                      </div>
                      {req.adminNotes && (
                        <div className="text-sm text-muted-foreground mt-1.5 italic rounded-md bg-muted/50 px-3 py-2">
                          💬 {req.adminNotes}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ─── Upgrade Modal ────────────────────────────────────────── */}
      <UpgradePlanModal
        open={upgradeModalOpen}
        onOpenChange={setUpgradeModalOpen}
        selectedPlan={selectedPlan}
        tenant={tenant}
        onRequestCreated={fetchRequests}
      />
    </div>
  )
}
