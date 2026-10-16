import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AccountPage from "@/app/dashboard/account/page"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), consent: vi.fn(), redirect: vi.fn(), cardProps: [] as unknown[] }))

/**
 * The card is a client component with hooks: in this suite's bare RSC-render
 * pattern it can only be STUBBED (no reconciler exists to run its hooks).
 * The page test therefore asserts the wiring (props recorded below), and the
 * card's copy is asserted through the real module's pure label derivations,
 * which are exactly what the card renders.
 */
vi.mock("@/components/account/career-consent-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/account/career-consent-card")>()
  return {
    CareerConsentCard: (props: { granted: boolean; consentedAt: string | null }) => {
      mocks.cardProps.push(props)
      return null
    },
    describeCareerConsent: real.describeCareerConsent,
    consentControlLabel: real.consentControlLabel,
  }
})

import {
  describeCareerConsent, consentControlLabel,
} from "@/components/account/career-consent-card"

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/career-records", () => ({ readMyCareerConsent: mocks.consent }))

const CONSENTED_AT = new Date("2026-10-17T00:00:00Z")

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out }
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode }
  if (typeof node.type === "function") return collectText((node.type as (p: unknown) => unknown)(props), out)
  React.Children.forEach(props.children, (child) => collectText(child, out))
  return out
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.cardProps.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
  mocks.redirect.mockImplementation(() => { throw new Error("redirect") })
})

describe("Consent card copy (pure label derivations)", () => {
  it("labels the granted state with its since-date and a revocation control", () => {
    expect(describeCareerConsent(true, CONSENTED_AT.toISOString())).toContain("Allowed")
    expect(describeCareerConsent(true, null)).toBe("Allowed")
    expect(consentControlLabel(true)).toBe("Stop cross-league career linking")
  })

  it("labels the not-granted state and its grant control", () => {
    expect(describeCareerConsent(false, null)).toBe("Not allowed")
    expect(consentControlLabel(false)).toBe("Allow cross-league career linking")
  })
})

describe("Personal account page (PUB-03 consent surface)", () => {
  it("wires the reader's state into the card verbatim", async () => {
    mocks.consent.mockResolvedValue({ granted: true, consentedAt: CONSENTED_AT })
    collectText(await AccountPage())
    expect(mocks.cardProps).toEqual([{ granted: true, consentedAt: CONSENTED_AT.toISOString() }])
    expect(mocks.cardProps.length).toBe(1)
  })

  it("wires a not-granted state verbatim (null date preserved)", async () => {
    mocks.consent.mockResolvedValue({ granted: false, consentedAt: null })
    collectText(await AccountPage())
    expect(mocks.cardProps).toEqual([{ granted: false, consentedAt: null }])
  })

  it("links back to the dashboard", async () => {
    mocks.consent.mockResolvedValue({ granted: false, consentedAt: null })
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("Back to dashboard")
  })

  it("redirects an unauthenticated visitor before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(AccountPage()).rejects.toThrow("redirect")
    expect(mocks.consent).not.toHaveBeenCalled()
  })
})
