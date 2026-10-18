import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Link from "next/link"
import AccountPage from "@/app/dashboard/account/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), consent: vi.fn(), hub: vi.fn(), tz: vi.fn(), name: vi.fn(), redirect: vi.fn(),
  cardProps: [] as unknown[], zoneProps: [] as unknown[], nameProps: [] as unknown[],
}))

/**
 * The cards are client components with hooks: in this suite's bare RSC-render
 * pattern they can only be STUBBED (no reconciler exists to run their hooks).
 * The page test therefore asserts the wiring (props recorded below), and each
 * card's copy is asserted through the real module's pure label derivations,
 * which are exactly what the cards render.
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

vi.mock("@/components/account/display-timezone-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/account/display-timezone-card")>()
  return {
    DisplayTimezoneCard: (props: { timeZone: string | null }) => {
      mocks.zoneProps.push(props)
      return null
    },
    describeDisplayTimeZone: real.describeDisplayTimeZone,
  }
})

// The display-name card is stubbed like its siblings; its copy rides on the
// real policy's describe function (imported below for the copy assertions).
vi.mock("@/components/account/display-name-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/account/display-name-card")>()
  return {
    DisplayNameCard: (props: { displayName: string | null }) => {
      mocks.nameProps.push(props)
      return null
    },
    describeDisplayName: real.describeDisplayName,
  }
})

import { describeCareerConsent, consentControlLabel } from "@/components/account/career-consent-card"
import { describeDisplayTimeZone } from "@/components/account/display-timezone-card"
import { describeDisplayName } from "@/components/account/display-name-card"

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/career-records", () => ({ readMyCareerConsent: mocks.consent }))
vi.mock("@/lib/career-hub", () => ({ readMyCareerHub: mocks.hub }))
vi.mock("@/lib/account-preferences", () => ({ readMyDisplayTimeZone: mocks.tz }))
vi.mock("@/lib/profile-records", () => ({ readMyDisplayName: mocks.name }))

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
  mocks.zoneProps.length = 0
  mocks.nameProps.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
  mocks.redirect.mockImplementation(() => { throw new Error("redirect") })
  mocks.consent.mockResolvedValue({ granted: false, consentedAt: null })
  mocks.hub.mockResolvedValue({ consented: false, career: null, leagues: [] })
  mocks.tz.mockResolvedValue({ timeZone: null })
  mocks.name.mockResolvedValue(null)
})

describe("Display timezone card copy (pure label derivation)", () => {
  it("states the honest default when nothing is configured", () => {
    expect(describeDisplayTimeZone(null)).toContain("UTC (default)")
  })
  it("states the chosen zone when one is configured", () => {
    expect(describeDisplayTimeZone("Asia/Karachi")).toBe("Dates and times show in Asia/Karachi.")
  })
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

describe("Display timezone wiring (UX-03)", () => {
  it("wires the reader's zone into the card verbatim", async () => {
    mocks.tz.mockResolvedValue({ timeZone: "Asia/Karachi" })
    collectText(await AccountPage())
    expect(mocks.zoneProps).toEqual([{ timeZone: "Asia/Karachi" }])
    // The consent card is unaffected by the preference read.
    expect(mocks.cardProps).toHaveLength(1)
  })

  it("wires an unset preference verbatim (null preserved, never fabricated)", async () => {
    await AccountPage()
    collectText(await AccountPage())
    expect(mocks.zoneProps).toEqual([{ timeZone: null }])
  })

  it("renders the honest UTC default instead of failing the page when the tz read errors", async () => {
    mocks.tz.mockRejectedValue(new Error("db down"))
    const text = collectText(await AccountPage()).join(" ")
    expect(mocks.zoneProps).toEqual([{ timeZone: null }])
    expect(text).toContain("Your account")
  })
})

describe("Display-name wiring (REG-05, Batch 142)", () => {
  it("copies the pure describe function verbatim", () => {
    expect(describeDisplayName("Ayesha Khan")).toContain('"Ayesha Khan"')
    expect(describeDisplayName(null)).toMatch(/unnamed/)
  })

  it("wires the reader's name into the card verbatim (null preserved)", async () => {
    mocks.name.mockResolvedValue("Ayesha Khan")
    collectText(await AccountPage())
    expect(mocks.nameProps).toEqual([{ displayName: "Ayesha Khan" }])
    mocks.name.mockResolvedValue(null)
    collectText(await AccountPage())
    expect(mocks.nameProps).toEqual([{ displayName: "Ayesha Khan" }, { displayName: null }])
  })

  it("renders the page with an unset name instead of failing when the read errors", async () => {
    mocks.name.mockRejectedValue(new Error("db down"))
    const text = collectText(await AccountPage()).join(" ")
    expect(mocks.nameProps).toEqual([{ displayName: null }])
    expect(text).toContain("Your account")
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
    expect(mocks.tz).not.toHaveBeenCalled()
  })
})
