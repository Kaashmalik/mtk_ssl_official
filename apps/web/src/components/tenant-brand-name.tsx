"use client"

import * as React from "react"
import { PLATFORM_NAME, shortTenantLabel } from "@/lib/white-label-metadata"

/**
 * Batch 128: the client-side brand name, resolved SERVER-side in the root
 * layout from the same gated per-request brand read that feeds the head
 * metadata, the PWA manifest, and the visible home hero. Consumers (header,
 * sidebar, share surfaces) render THE TENANT'S name; hosts with no
 * configured branding get the platform brand. No client component ever
 * hardcodes either string.
 *
 * Batch 176 (PREM-02): the context also carries the chrome identity fields
 * that previously never reached the client — the tenant logo (sidebar
 * switcher replaces the platform icon) and the hideSslBranding flag (the
 * Pro/Enterprise-gated "Powered by" credit). Both stay optional so every
 * pre-176 consumer contract is unchanged.
 */

export type TenantBrandName = {
  name: string
  short: string
  /** HTTPS-only tenant logo; absent = the platform icon. */
  logoUrl?: string
  /** Pro/Enterprise-gated: hide the platform credit from the chrome. */
  hideSslBranding?: boolean
}

const Context = React.createContext<TenantBrandName>({
  name: PLATFORM_NAME,
  short: shortTenantLabel(null),
})

export function TenantBrandNameProvider({ value, children }: { value: TenantBrandName; children: React.ReactNode }) {
  return React.createElement(Context.Provider, { value }, children)
}

export function useTenantBrandName(): TenantBrandName {
  return React.useContext(Context)
}
