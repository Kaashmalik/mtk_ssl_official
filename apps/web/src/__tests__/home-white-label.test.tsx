import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 125: the VISIBLE brand goes white-label too. The document head has
 * been white-label since Batch 115, but the home hero navbar still hardcoded
 * the platform name client-side — a branded tenant's landing page literally
 * said "Shakir Super League" in its own navigation while the head metadata
 * said otherwise. The name is now a server-resolved prop from the SAME
 * request-local brand read, with the platform name as the fallback.
 *
 * Page tests tree-walk (the repo idiom): the async server page is invoked
 * directly, and the hero client component is executed with the EXACT props
 * the page passed it — Clerk and motion boundaries are stubbed, the real
 * brand wiring is not.
 */

afterEach(() => vi.resetModules())

vi.mock("@/lib/request-brand", () => ({
  readRequestBrand: vi.fn(async () => (globalThis as any).__batch125Brand ?? null),
}))

vi.mock("@/components/structured-data", () => ({ StructuredData: () => null }))

vi.mock("@/lib/home-pulse", () => ({ readHomePulse: vi.fn(async () => null) }))

vi.mock("@/components/providers", () => ({ useClerkReady: () => true }))

vi.mock("@mtk/ui/components/theme-toggle", () => ({ ThemeToggle: () => null }))

vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({
  MotionWrapper: (props: { children?: unknown }) => props.children,
}))

vi.mock("@clerk/nextjs", () => ({
  SignInButton: (props: { children?: unknown }) => props.children,
  SignedIn: (props: { children?: unknown }) => props.children,
  SignedOut: (props: { children?: unknown }) => props.children,
  UserButton: () => null,
}))

function texts(node: any, bucket: string[] = []): string[] {
  if (Array.isArray(node)) return node.flatMap((child) => texts(child, bucket))
  if (typeof node === "string" || typeof node === "number") { bucket.push(String(node)); return bucket }
  if (!React.isValidElement(node)) return bucket
  texts((node.props as any).children, bucket)
  return bucket
}

function findNamed(node: any, name: string, out: any[] = []): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => findNamed(child, name, out))
  if (!React.isValidElement(node)) return out
  if (typeof node.type === "function" && node.type.name === name) out.push(node)
  return findNamed((node.props as any).children, name, out)
}

describe("Home page white-label brand (Batch 125)", () => {
  it("a branded tenant's landing page shows THE TENANT'S name in the real hero, never the platform's", async () => {
    vi.resetModules()
    ;(globalThis as any).__batch125Brand = { appName: "Falcon Premier League", primaryColor: "#1d4ed8" }
    const HomePage = (await import("../app/page")).default
    const tree = await HomePage()
    const hero = findNamed(tree, "HomeContent")[0]
    expect(hero).toBeTruthy()
    // The page passed the tenant's OWN resolved name — not the platform's.
    expect((hero.props as any).brandName).toBe("Falcon Premier League")
    const copy = texts((hero.type as any)(hero.props)).join("\n")
    expect(copy).toContain("Falcon Premier League")
    expect(copy).not.toContain("Shakir Super League")
  })

  it("an unconfigured host keeps the platform name end-to-end", async () => {
    vi.resetModules()
    ;(globalThis as any).__batch125Brand = null
    const HomePage = (await import("../app/page")).default
    const tree = await HomePage()
    const hero = findNamed(tree, "HomeContent")[0]
    expect((hero.props as any).brandName).toBe("Shakir Super League")
    const copy = texts((hero.type as any)(hero.props)).join("\n")
    expect(copy).toContain("Shakir Super League")
  })
})
