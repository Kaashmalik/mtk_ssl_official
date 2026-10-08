"use client"

import { AlertTriangle, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import type { PlanLimitDetail } from "@mtk/database"

const FEATURE_LABELS: Record<string, string> = {
  maxTeams: "teams",
  maxPlayers: "players",
  whiteLabel: "white-label branding",
  customDomain: "custom domains",
  liveStreaming: "live streaming",
}

function titleCase(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

/**
 * Explains a plan restriction and offers the upgrade path.
 *
 * Render this in place of a generic error when
 * `resolveActionError(err, fallback).planLimit` is non-null. The important part is
 * that hitting a limit reads as a *billing* event with a next step, not as a
 * failure the user caused.
 */
export function PlanLimitNotice({ detail }: { detail: PlanLimitDetail }) {
  const label = FEATURE_LABELS[detail.feature] ?? detail.feature
  const isQuota = detail.allowed > 0

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">
            {isQuota
              ? `${titleCase(detail.currentPlan)} plan ${label} limit reached`
              : `Not available on the ${titleCase(detail.currentPlan)} plan`}
          </p>

          {isQuota ? (
            <p className="text-sm text-muted-foreground">
              You have used all {detail.allowed} {label} included in your plan.
              {detail.suggestedPlan !== detail.currentPlan
                ? ` The ${titleCase(detail.suggestedPlan)} plan raises this limit.`
                : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {titleCase(detail.feature === "liveStreaming" ? "live streaming" : label)} is
              not included in your current plan.
              {detail.suggestedPlan !== detail.currentPlan
                ? ` Upgrade to ${titleCase(detail.suggestedPlan)} to enable it.`
                : ""}
            </p>
          )}

          {detail.suggestedPlan !== detail.currentPlan && (
            <Button asChild size="sm" className="mt-1">
              <Link href="/dashboard/settings/billing">
                Upgrade to {titleCase(detail.suggestedPlan)}
                <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}