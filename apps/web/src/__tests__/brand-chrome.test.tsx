import React from "react"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * PREM-02 (Batch 176): the Brand Studio's remaining published fields finally
 * reach the dashboard chrome — logoUrl (sidebar + mobile header sheet),
 * customCss (server-rendered <style> in the root layout) and
 * hideSslBranding (the "Powered by" credit the setting has promised since
 * the studio shipped). The presentation layer is the boundary: these pins
 * hold it to trust-boundary discipline for the three NEW fields, and hold
 * the chrome consumers to rendering exactly what crossed it.
 */

afterEach(() => {
  vi.resetModules()
  ;(globalThis as any).__b176Ctx = undefined
})

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
  SignedIn: (p: any) => p.children,
  SignedOut: (p: any) => p.children,
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}))
vi.mock("@/components/providers", () => ({ useClerkReady: () => true }))
vi.mock("@/components/layout/notification-bell", () => ({ NotificationBell: () => null }))
vi.mock("@/components/layout/locale-switcher", () => ({ LocaleSwitcher: () => null }))
vi.mock("@mtk/ui/components/theme-toggle", () => ({ ThemeToggle: () => null }))
vi.mock("@mtk/ui/components/ui/command-palette", () => ({
  CommandDialog: (p: any) => p?.children ?? null,
  CommandInput: () => null,
  CommandList: (p: any) => p?.children ?? null,
  CommandEmpty: (p: any) => p?.children ?? null,
  CommandGroup: (p: any) => p?.children ?? null,
  CommandItem: (p: any) => p?.children ?? null,
  CommandShortcut: (p: any) => p?.children ?? null,
}))
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => (p: any) => p?.children ?? null }),
  AnimatePresence: (p: any) => p?.children ?? null,
}))
vi.mock("@mtk/ui/components/ui/sheet", () => ({
  Sheet: (p: any) => p?.children ?? null,
  SheetContent: (p: any) => p?.children ?? null,
  SheetTrigger: (p: any) => p?.children ?? null,
}))
vi.mock("@mtk/ui/components/ui/button", () => ({
  Button: (p: any) => (p?.asChild ? p?.children : React.createElement("button", null, p?.children)),
}))

// The context mock delegates to the REAL module: bare consumers get the
// platform defaults; a test sets __b176Ctx to simulate a branded tenant.
vi.mock("@/components/tenant-brand-name", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/tenant-brand-name")>()
  return {
    TenantBrandNameProvider: actual.TenantBrandNameProvider,
    useTenantBrandName: () => (globalThis as any).__b176Ctx ?? actual.useTenantBrandName(),
  }
})

const LOGO = "https://cdn.example/leagues/falcon-logo"

describe("PREM-02 (Batch 176): the chrome identity crosses the presentation boundary honestly", () => {
  it("brandPresentation accepts an HTTPS logoUrl and refuses http, credentials and non-urls", async () => {
    const { brandPresentation } = await import("../lib/brand-presentation")
    expect(brandPresentation({ logoUrl: LOGO })?.logoUrl).toBe(LOGO)
    expect(brandPresentation({ logoUrl: "http://cdn.example/logo.png" })?.logoUrl).toBeUndefined()
    expect(brandPresentation({ logoUrl: "javascript:alert(1)" })?.logoUrl).toBeUndefined()
    expect(brandPresentation({ logoUrl: "https://user:pass@cdn.example/logo.png" })?.logoUrl).toBeUndefined()
    expect(brandPresentation({ logoUrl: 42 })?.logoUrl).toBeUndefined()
  })

  it("hideSslBranding is a boolean boundary: only literally true crosses it", async () => {
    const { brandPresentation } = await import("../lib/brand-presentation")
    expect(brandPresentation({ hideSslBranding: true })?.hideSslBranding).toBe(true)
    expect(brandPresentation({})?.hideSslBranding).toBe(false)
    expect(brandPresentation({ hideSslBranding: "true" })?.hideSslBranding).toBe(false)
    expect(brandPresentation({ hideSslBranding: 1 })?.hideSslBranding).toBe(false)
  })

  it("customCss is length-bounded and strip-neutralized, never 'sanitized into safety'", async () => {
    const { brandPresentation } = await import("../lib/brand-presentation")
    const css = brandPresentation({ customCss: ".hero{color:red}" })?.customCss
    expect(css).toBe(".hero{color:red}")

    // Control characters are stripped; tab/newline/carriage return survive.
    expect(brandPresentation({ customCss: "\u0001.a\u0002{}\t\n\r" })?.customCss).toBe(".a{}\t\n\r")

    // `</style` in ANY case must not be able to close the injected element.
    const escaped = brandPresentation({ customCss: ".a{content:\"</STYLE\"}" })?.customCss
    expect(escaped).not.toContain("</STYLE")
    expect(escaped?.toLowerCase()).toContain("<\\/style")

    // Hard 20k cap: a tenant cannot ship unbounded bytes to every page view.
    expect(brandPresentation({ customCss: "a".repeat(21_000) })?.customCss).toHaveLength(20_000)

    // Empty/whitespace-only CSS is absent (undefined), not an empty <style>.
    expect(brandPresentation({ customCss: "" })?.customCss).toBeUndefined()
    expect(brandPresentation({ customCss: "   " })?.customCss).toBeUndefined()
  })

  it("the sidebar renders the tenant logo in the switcher slot and the platform credit by default", { timeout: 30_000 }, async () => {
    ;(globalThis as any).__b176Ctx = { name: "Falcon Premier League", short: "Falcon", logoUrl: LOGO }
    const { Sidebar } = await import("../components/layout/sidebar")
    const markup = renderToStaticMarkup(React.createElement(Sidebar, {}))
    expect(markup).toContain(LOGO)
    expect(markup).toContain("Powered by")
    vi.resetModules()
    ;(globalThis as any).__b176Ctx = undefined
    const { Sidebar: BareSidebar } = await import("../components/layout/sidebar")
    const bare = renderToStaticMarkup(React.createElement(BareSidebar, {}))
    expect(bare).not.toContain("cdn.example")
    expect(bare).toContain("Powered by") // unbranded hosts still credit the platform honestly
  })

  it("the sidebar honors hideSslBranding: the platform credit disappears, the chrome stays", { timeout: 30_000 }, async () => {
    ;(globalThis as any).__b176Ctx = { name: "Falcon Premier League", short: "Falcon", hideSslBranding: true }
    const { Sidebar } = await import("../components/layout/sidebar")
    const markup = renderToStaticMarkup(React.createElement(Sidebar, {}))
    expect(markup).toContain("Falcon Premier League")
    expect(markup).not.toContain("Powered by")
  })

  it("the mobile header sheet renders the tenant logo; the bare header keeps the platform icon", { timeout: 30_000 }, async () => {
    ;(globalThis as any).__b176Ctx = { name: "Falcon Premier League", short: "Falcon", logoUrl: LOGO }
    const { Header } = await import("../components/layout/header")
    const markup = renderToStaticMarkup(React.createElement(Header, {}))
    expect(markup).toContain(LOGO)
    vi.resetModules()
    ;(globalThis as any).__b176Ctx = undefined
    const { Header: BareHeader } = await import("../components/layout/header")
    const bare = renderToStaticMarkup(React.createElement(BareHeader, {}))
    expect(bare).not.toContain("cdn.example")
  })

  it("the platform credit resolves its label through the allowlist - never a hardcoded string", async () => {
    ;(globalThis as any).__b176Ctx = { hideSslBranding: true }
    const { PlatformCredit } = await import("../components/layout/platform-credit")
    expect(renderToStaticMarkup(React.createElement(PlatformCredit))).toBe("")
    vi.resetModules()
    ;(globalThis as any).__b176Ctx = undefined
    const { PlatformCredit: Visible } = await import("../components/layout/platform-credit")
    const markup = renderToStaticMarkup(React.createElement(Visible))
    expect(markup).toContain("Powered by")
    expect(markup).toContain("SSL") // shortTenantLabel(null): the platform's own short name
  })

  it("the root layout injects customCss SERVER-side (source pin): a branded page never flashes unbranded", () => {
    // renderToStaticMarkup cannot run a next/font root layout outside Next;
    // the layout's SERVER contract is pinned against its source instead —
    // same discipline as the ISO source scans.
    const layout = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "app", "layout.tsx"), "utf8")
    expect(layout).toContain("id=\"tenant-custom-css\"")
    expect(layout).toContain("branding?.customCss")
    expect(layout).toContain("dangerouslySetInnerHTML")
    // The chrome identity fields must thread into the client context too.
    expect(layout).toContain("logoUrl: branding?.logoUrl")
    expect(layout).toContain("hideSslBranding: branding?.hideSslBranding")
  })
})
