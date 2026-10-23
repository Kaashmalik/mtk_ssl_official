import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 125: the sign-up screen carries the host tenant's brand, not the
 * platform's. Landing on a branded league's invite/signup link must read
 * like the league's own product. (request-brand is mocked: its Clerk import
 * cannot run in the node test env; the host-tenant branch of the real
 * readRequestBrand itself needs no auth.)
 */

afterEach(() => vi.resetModules())

vi.mock("@/lib/request-brand", () => ({
  readRequestBrand: vi.fn(async () => (globalThis as any).__batch125Brand ?? null),
}))

vi.mock("@/app/sign-up/[[...sign-up]]/clerk-sign-up", () => ({ ClerkSignUp: () => null }))

function texts(node: any, bucket: string[] = []): string[] {
  if (Array.isArray(node)) return node.flatMap((child) => texts(child, bucket))
  if (typeof node === "string" || typeof node === "number") { bucket.push(String(node)); return bucket }
  if (!React.isValidElement(node)) return bucket
  texts((node.props as any).children, bucket)
  return bucket
}

describe("Sign-up white-label brand (Batch 125)", () => {
  it("a branded host shows THE TENANT'S name and short label", async () => {
    vi.resetModules()
    ;(globalThis as any).__batch125Brand = { appName: "Falcon Premier League", primaryColor: "#1d4ed8" }
    const SignUpPage = (await import("../app/sign-up/[[...sign-up]]/page")).default
    const copy = texts(await SignUpPage()).join("\n")
    expect(copy).toContain("Falcon Premier League")
    expect(copy).toContain("Create your Falcon account")
    expect(copy).not.toContain("Shakir Super League")
  })

  it("an unconfigured host keeps the platform branding", async () => {
    vi.resetModules()
    ;(globalThis as any).__batch125Brand = null
    const SignUpPage = (await import("../app/sign-up/[[...sign-up]]/page")).default
    const copy = texts(await SignUpPage()).join("\n")
    expect(copy).toContain("Shakir Super League")
    expect(copy).toContain("Create your SSL account")
  })
})
