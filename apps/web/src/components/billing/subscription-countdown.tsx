import { Badge } from "@mtk/ui/components/ui/badge"
import { getSubscriptionStatus, type DerivedSubscriptionStatus } from "@/lib/subscription-status"

const COLORS: Record<DerivedSubscriptionStatus, string> = {
  active: "bg-green-600 text-white",
  expiring: "bg-amber-500 text-white",
  critical: "bg-orange-600 text-white",
  grace: "bg-yellow-500 text-black",
  expired: "bg-red-600 text-white",
  trialing: "bg-purple-600 text-white",
  free: "bg-muted text-muted-foreground",
}

const LABELS: Record<DerivedSubscriptionStatus, string> = {
  active: "Active",
  expiring: "Expiring Soon",
  critical: "Urgent",
  grace: "Grace Period",
  expired: "Expired",
  trialing: "Trial",
  free: "Free",
}

export async function SubscriptionCountdown({ tenantId }: { tenantId: string }) {
  const info = await getSubscriptionStatus(tenantId)
  return (
    <Badge className={COLORS[info.status]}>
      {LABELS[info.status]}
      {info.daysRemaining !== null && info.status !== "free" && ` · ${info.daysRemaining}d left`}
    </Badge>
  )
}
