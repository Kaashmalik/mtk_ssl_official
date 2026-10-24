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
 */

export type TenantBrandName = { name: string; short: string }

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
