import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 128: the DASHBOARD SHELL and the SHARE surfaces stop advertising
 * the platform brand. Header, sidebar, share texts, and the home JSON-LD
 * all hardcoded "Shakir Super League" client-side — a branded league's own
 * members shared scorecards that named somebody else's product. One client
 * context (server-resolved in the layout from the SAME gated brand read)
 * now feeds every consumer, with the platform brand as the fallback.
 */

afterEach(() => {
  vi.resetModules()
  ;(globalThis as any).__b128Brand = undefined
  ;(globalThis as any).__b128Ctx = undefined
  ;(globalThis as any).__b128Captured = undefined
})

vi.mock("@/lib/request-brand", () => ({
  readRequestBrand: vi.fn(async () => (globalThis as any).__b128Brand ?? null),
}))

vi.mock("@/components/structured-data", () => ({
  StructuredData: function StructuredData(props: any) {
    ;(globalThis as any).__b128Captured = props
    return null
  },
}))

// The context mock delegates to the REAL module: bare component executions
// get whatever __b128Ctx holds (tenant scenario), otherwise the real
// platform defaults.
vi.mock("@/components/tenant-brand-name", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/tenant-brand-name")>()
  return {
    TenantBrandNameProvider: actual.TenantBrandNameProvider,
    useTenantBrandName: () => (globalThis as any).__b128Ctx ?? actual.useTenantBrandName(),
  }
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

function findNamed(node: any, name: string, out: any[] = []): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => findNamed(child, name, out))
  if (!React.isValidElement(node)) return out
  const typeName = typeof node.type === "function" ? (node.type as any).name : undefined
  if (typeName === name) out.push(node)
  return findNamed((node.props as any)?.children, name, out)
}

describe("Tenant brand-name context (Batch 128)", () => {
  it("consumers get the tenant's name/short from the provider; default is the platform", async () => {
    vi.resetModules()
    const actual = await vi.importActual<typeof import("@/components/tenant-brand-name")>("@/components/tenant-brand-name")
    function Consumer() {
      const { name, short } = actual.useTenantBrandName()
      return React.createElement("span", null, `${name}/${short}`)
    }
    const markup = renderToStaticMarkup(
      React.createElement(actual.TenantBrandNameProvider, { value: { name: "Falcon Premier League", short: "Falcon" }, children: React.createElement(Consumer) }),
    )
    expect(markup).toBe("<span>Falcon Premier League/Falcon</span>")
    vi.resetModules()
    const fresh = await vi.importActual<typeof import("@/components/tenant-brand-name")>("@/components/tenant-brand-name")
    function BareConsumer() {
      const { name, short } = fresh.useTenantBrandName()
      return React.createElement("span", null, `${name}/${short}`)
    }
    const bare = renderToStaticMarkup(React.createElement(BareConsumer))
    expect(bare).toBe("<span>Shakir Super League/SSL</span>")
  })

  it("the home page feeds the resolved tenant name into the JSON-LD emitter", async () => {
    ;(globalThis as any).__b128Brand = { appName: "Falcon Premier League", primaryColor: "#1d4ed8" }
    const HomePage = (await import("../app/page")).default
    const tree = await HomePage()
    // The StructuredData element in the server tree carries the prop.
    const el = findNamed(tree, "StructuredData")[0]
    expect((el.props as any).organizationName).toBe("Falcon Premier League")
  })

  it("the home JSON-LD carries the tenant org — never the platform's", async () => {
    vi.resetModules()
    const actual = await vi.importActual<typeof import("../components/structured-data")>("../components/structured-data")
    const html = String((actual.StructuredData({ organizationName: "Falcon Premier League" }) as any).props.dangerouslySetInnerHTML.__html)
    expect(html).toContain("Falcon Premier League")
    expect(html).not.toContain("Shakir Super League")
  })

  it("share texts carry the league's short label, not a hardcoded SSL", async () => {
    vi.resetModules()
    const { buildMatchShareText, buildTournamentShareText } = await import("../lib/share-texts")
    expect(buildTournamentShareText("Falcon", "Spring Cup", "Tigers")).toBe("🏏 Falcon: Spring Cup - Champions: Tigers")
    expect(buildTournamentShareText("Falcon", "Spring Cup", null)).toBe("🏏 Falcon Tournament: Spring Cup")
    expect(buildMatchShareText("Falcon", "A Team", "B Team", "A won by 4")).toBe("🏏 Falcon Match Update: A Team vs B Team - A won by 4")
  })

  it("the desktop sidebar brands itself with the tenant", async () => {
    ;(globalThis as any).__b128Ctx = { name: "Falcon Premier League", short: "Falcon" }
    vi.resetModules()
    const { Sidebar } = await import("../components/layout/sidebar")
    const markup = renderToStaticMarkup(React.createElement(Sidebar, {}))
    expect(markup).toContain("Falcon Premier League")
    expect(markup).not.toContain("Shakir Super League")
  })

  it("the mobile header sheet brands itself with the tenant", async () => {
    ;(globalThis as any).__b128Ctx = { name: "Falcon Premier League", short: "Falcon" }
    vi.resetModules()
    const { Header } = await import("../components/layout/header")
    const markup = renderToStaticMarkup(React.createElement(Header, {}))
    expect(markup).toContain("Falcon Premier League")
    expect(markup).not.toContain("Shakir Super League")
  })
})
