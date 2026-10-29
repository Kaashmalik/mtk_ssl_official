"use client"

import * as React from "react"
import Script from "next/script"
import { usePathname } from "next/navigation"
import { useTenantBrandName } from "@/components/tenant-brand-name"
import { adsAllowedOnPath } from "@/lib/adsense"

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

/**
 * Loads the AdSense library on public pages only. `client` comes from the
 * server (null when unconfigured) and a tenant that paid to hide platform
 * branding never gets platform ads. Auto ads should stay OFF in the AdSense
 * console; placements are the explicit <AdSlot>s below.
 */
export function AdSenseScript({ client }: { client: string | null }) {
  const pathname = usePathname() ?? "/"
  const { hideSslBranding } = useTenantBrandName()
  if (!client || hideSslBranding || !adsAllowedOnPath(pathname)) return null
  return (
    <Script
      id="adsbygoogle-init"
      async
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
    />
  )
}

/**
 * One responsive ad unit. Space is reserved up front (min-height) so the
 * content never jumps when the ad fills: layout shift hurts readers and
 * Core Web Vitals. Clearly labelled, and kept away from interactive controls.
 */
export function AdSlot({ client, slot, className }: { client: string | null; slot: string | null; className?: string }) {
  const { hideSslBranding } = useTenantBrandName()
  const pushed = React.useRef(false)
  const enabled = Boolean(client && slot && !hideSslBranding)

  React.useEffect(() => {
    if (!enabled || pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      // An ad blocker or an unfilled slot must never break the page.
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <aside aria-label="Advertisement" className={`my-10 ${className ?? ""}`}>
      <p className="mb-1 text-center text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Advertisement</p>
      <ins
        className="adsbygoogle block min-h-[280px] w-full overflow-hidden rounded-xl bg-muted/30"
        style={{ display: "block" }}
        data-ad-client={client ?? undefined}
        data-ad-slot={slot ?? undefined}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  )
}
