import { beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"

/**
 * FAN-03 UI slice tests: share-card text/URL builders (public route only),
 * milestone copy helpers (evidence value verbatim, celebration disclosed)
 * and the public milestones reader (derived facts through the publication
 * gate - never fabricated entries).
 */

const capturedRuns: { rows: unknown[] } = { rows: [] }

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: () => {
      let call = 0
      const order = [capturedRuns.rows as unknown[], [] as unknown[]]
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: async () => order[Math.min(call++, order.length - 1)],
      }
      return chain
    },
  },
}))

import { readPublishedTournamentMilestones } from "@/lib/public-visibility"
import { MilestoneCards, MILESTONE_LABELS, milestoneLine } from "@/components/tournaments/milestone-cards"
import {
  buildTournamentShareText, buildShareUrl, tournamentSharePath,
  whatsappShareUrl, twitterShareUrl, facebookShareUrl, TOURNAMENT_SHARE_LABELS,
} from "@/components/shared/tournament-share-card"

const entry = (playerId: string, value: number, verified = true) => ({
  playerId, playerName: `Player ${playerId}`, playerVerified: verified, value,
  recordedAt: "2026-10-18T10:00:00.000Z",
})

describe("Tournament share builders (public route only)", () => {
  it("shares the public /tournaments path with an honest champion mention", () => {
    expect(tournamentSharePath("t1")).toBe("/tournaments/t1")
    expect(buildShareUrl("t1", "https://ssl.example")).toBe("https://ssl.example/tournaments/t1")
    expect(buildTournamentShareText("Autumn Cup", "Team A")).toBe("🏏 SSL: Autumn Cup - Champions: Team A")
    expect(buildTournamentShareText("Autumn Cup", null)).toBe("🏏 SSL Tournament: Autumn Cup")
    expect(buildTournamentShareText("Autumn Cup")).toBe("🏏 SSL Tournament: Autumn Cup")
  })

  it("encodes share targets for each network", () => {
    expect(whatsappShareUrl("hi there", "https://x/t1")).toContain("hi%20there")
    expect(twitterShareUrl("hi there", "https://x/t1")).toContain("url=https%3A%2F%2Fx%2Ft1")
    expect(facebookShareUrl("https://x/t1")).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fx%2Ft1")
    expect(TOURNAMENT_SHARE_LABELS.trigger).toBe("Share")
  })
})

describe("Milestone cards (derived-facts presentation)", () => {
  it("renders the evidence value verbatim for both kinds", () => {
    expect(milestoneLine(entry("p1", 120), "century")).toBe("Player p1 - 120 runs")
    expect(milestoneLine(entry("p2", 6), "fiveFor")).toBe("Player p2 - 6 wickets")
  })

  it("discloses that milestones feed no official decision and never fabricate entries", () => {
    expect(MILESTONE_LABELS.engagementNote).toMatch(/no official decision/i)
    expect(MILESTONE_LABELS.empty).toMatch(/official scorecards/i)
  })

  it("builds an element with the bounded entries it was given (createElement, no hook calls)", () => {
    const element = React.createElement(MilestoneCards, {
      milestones: { centuries: [entry("p1", 120)], fiveFors: [] },
    })
    expect(element.type).toBe(MilestoneCards)
    expect(JSON.stringify(element.props)).toContain("120")
  })
})

describe("readPublishedTournamentMilestones (publication-gated derivation)", () => {
  beforeEach(() => {
    capturedRuns.rows = []
  })

  it("keeps only rows the per-innings policy admits, sorted best-first, bounded", async () => {
    capturedRuns.rows = [
      { playerId: "a", playerName: "A", runs: 103, playerUserId: "u1", linkedUserActive: true, recordedAt: new Date("2026-10-18T10:00:00Z") },
      { playerId: "b", playerName: "B", runs: 58, playerUserId: null, linkedUserActive: null, recordedAt: new Date("2026-10-18T10:01:00Z") },
      { playerId: "c", playerName: "C", runs: 214, playerUserId: "u2", linkedUserActive: false, recordedAt: new Date("2026-10-18T10:02:00Z") },
    ]
    const { centuries, fiveFors } = await readPublishedTournamentMilestones("t1", "tt1")
    expect(centuries.map(m => `${m.playerName}:${m.value}`)).toEqual(["C:214", "A:103"])
    expect(centuries[0].playerVerified).toBe(false)
    expect(centuries[1].playerVerified).toBe(true)
    // The bowling read uses the same chain shape; its rows were empty here.
    expect(fiveFors).toEqual([])
  })

  it("returns empty sections when no scorecard rows qualify", async () => {
    capturedRuns.rows = [{ playerId: "a", playerName: "A", runs: 58, playerUserId: null, linkedUserActive: null, recordedAt: new Date("2026-10-18T10:00:00Z") }]
    const { centuries, fiveFors } = await readPublishedTournamentMilestones("t1", "tt1")
    expect(centuries).toEqual([])
    expect(fiveFors).toEqual([])
  })
})
