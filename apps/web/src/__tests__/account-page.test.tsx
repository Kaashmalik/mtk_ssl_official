import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Link from "next/link"
import AccountPage from "@/app/dashboard/account/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), consent: vi.fn(), hub: vi.fn(), redirect: vi.fn(), cardProps: [] as unknown[],
}))

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

import { describeCareerConsent, consentControlLabel } from "@/components/account/career-consent-card"

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/career-records", () => ({ readMyCareerConsent: mocks.consent }))
vi.mock("@/lib/career-hub", () => ({ readMyCareerHub: mocks.hub }))

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
  mocks.consent.mockResolvedValue({ granted: false, consentedAt: null })
  mocks.hub.mockResolvedValue({ consented: false, career: null, leagues: [] })
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

describe("Personal account page (PUB-03/PUB-02 surfaces)", () => {
  it("wires the reader's state into the card verbatim", async () => {
    mocks.consent.mockResolvedValue({ granted: true, consentedAt: CONSENTED_AT })
    collectText(await AccountPage())
    expect(mocks.cardProps).toEqual([{ granted: true, consentedAt: CONSENTED_AT.toISOString() }])
  })

  it("wires a not-granted state verbatim (null date preserved)", async () => {
    mocks.consent.mockResolvedValue({ granted: false, consentedAt: null })
    collectText(await AccountPage())
    expect(mocks.cardProps).toEqual([{ granted: false, consentedAt: null }])
  })

  it("renders the consented career with per-league provenance and totals", async () => {
    mocks.consent.mockResolvedValue({ granted: true, consentedAt: CONSENTED_AT })
    mocks.hub.mockResolvedValue({
      consented: true,
      career: {
        leagues: [
          { tenantId: "t1", leagueName: "Alpha", runsScored: 120, wicketsTaken: 3 },
          { tenantId: "t2", leagueName: "Beta", runsScored: 80, wicketsTaken: 11 },
        ],
        totalRunsScored: 200,
        totalWicketsTaken: 14,
      },
      leagues: [
        { tenantId: "t1", leagueName: "Alpha", runsScored: 120, wicketsTaken: 3 },
        { tenantId: "t2", leagueName: "Beta", runsScored: 80, wicketsTaken: 11 },
      ],
    })
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("Your public career")
    expect(text).toContain("Alpha")
    expect(text).toContain("Beta")
    expect(text).toContain("Career total")
    expect(text).toContain("200")
    expect(text).toContain("14")
  })

  it("shows the public hub profile link once linking is allowed and leagues exist", async () => {
    mocks.consent.mockResolvedValue({ granted: true, consentedAt: CONSENTED_AT })
    mocks.hub.mockResolvedValue({
      consented: true,
      profilePath: "/hub/players/u1",
      career: {
        leagues: [{ tenantId: "t1", leagueName: "Alpha", runsScored: 120, wicketsTaken: 3 }],
        totalRunsScored: 120,
        totalWicketsTaken: 3,
      },
      leagues: [{ tenantId: "t1", leagueName: "Alpha", runsScored: 120, wicketsTaken: 3 }],
    })
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("your shareable profile link")
    const tree = await AccountPage()
    const links: unknown[] = []
    const walk = (node: unknown) => {
      if (!React.isValidElement(node)) return
      const props = node.props as { children?: React.ReactNode; href?: string }
      if (node.type === "a" || node.type === Link) links.push(props.href)
      React.Children.forEach(props.children, walk)
    }
    walk(tree)
    expect(links).toContain("/hub/players/u1")
  })

  it("keeps the linked career view empty-with-explainer while consent is withheld", async () => {
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("career view stays empty")
  })

  it("explains the empty consented state instead of fabricating zero rows", async () => {
    mocks.consent.mockResolvedValue({ granted: true, consentedAt: CONSENTED_AT })
    mocks.hub.mockResolvedValue({ consented: true, career: null, leagues: [] })
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("No published performances are linked")
  })

  it("shows a visible alert instead of failing the page when the hub read errors", async () => {
    mocks.hub.mockRejectedValue(new Error("db down"))
    const text = collectText(await AccountPage()).join(" ")
    expect(text).toContain("temporarily unavailable")
    expect(text).toContain("Your account")
  })

  it("redirects an unauthenticated visitor before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(AccountPage()).rejects.toThrow("redirect")
    expect(mocks.consent).not.toHaveBeenCalled()
    expect(mocks.hub).not.toHaveBeenCalled()
  })
})
