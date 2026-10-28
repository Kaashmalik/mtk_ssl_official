"use client"

import * as React from "react"
import { useTenantBrandName } from "@/components/tenant-brand-name"
import { shortTenantLabel } from "@/lib/white-label-metadata"

/**
 * PREM-02 (Batch 176): the platform attribution the hideSslBranding setting
 * has promised since the Brand Studio shipped — rendered for the first time
 * here, honestly. Every dashboard names the software it runs on UNLESS the
 * tenant turned the attribution off, which the write path gates to
 * Pro/Enterprise plans (brandingPlanViolation). The label is the platform's
 * OWN short name (never the tenant's — a league cannot credit itself), and
 * no client component hardcodes the string: it resolves through the same
 * allowlist the PWA manifest uses.
 */
export function PlatformCredit() {
  const { hideSslBranding } = useTenantBrandName()
  if (hideSslBranding) return null
  return (
    <p className="px-2 text-xs text-muted-foreground" data-testid="platform-credit">
      Powered by <span className="font-medium text-foreground/80">{shortTenantLabel(null)}</span>
    </p>
  )
}
