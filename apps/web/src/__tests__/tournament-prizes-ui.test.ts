import { describe, expect, it, vi } from "vitest"

/**
 * PUB-05 UI slice tests: the public prizes reader (drafts can never leak) and
 * the management-card copy (payout language says "recorded", never claims the
 * platform verified a payment).
 */

const captured: { limit?: number; rows?: unknown[] } = {}

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: () => {
      const chain: {
        from: () => typeof chain
        where: () => typeof chain
        orderBy: () => typeof chain
        limit: (n: number) => Promise<unknown[]>
      } = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: (n: number) => {
          captured.limit = n
          return Promise.resolve(captured.rows ?? [])
        },
      }
      return chain
    },
  },
}))

import { readPublishedTournamentPrizes } from "@/lib/public-visibility"
import {
  PRIZE_MANAGER_LABELS,
  PRIZE_CURRENCY_OPTIONS,
  prizeAmountLabel,
  prizeStatusBadge,
  prizePayoutLabel,
} from "@/components/tournaments/prize-management-card"

describe("readPublishedTournamentPrizes (public gallery)", () => {
  it("returns only rows the real visibility policy admits, bounded at the policy limit", async () => {
    captured.limit = undefined
    captured.rows = [
      { id: "p1", categoryName: "Winner", placement: "1st", amount: "50000.00", currency: "PKR", sponsor: "MalikTech", status: "approved", supersededAt: null },
      // Even if the WHERE clause regressed, the in-memory policy drop saves us:
      // drafts AND superseded history rows can never publicize.
      { id: "p2", categoryName: "Runner-up", placement: "2nd", amount: null, currency: "PKR", sponsor: null, status: "draft", supersededAt: null },
      { id: "p3", categoryName: "Winner", placement: "1st", amount: "40000.00", currency: "PKR", sponsor: "OldCo", status: "approved", supersededAt: new Date("2026-10-17T09:00:00Z") },
    ]
    const prizes = await readPublishedTournamentPrizes("t1", "tt1")
    expect(prizes).toHaveLength(1)
    expect(prizes[0]).toEqual({
      id: "p1",
      categoryName: "Winner",
      placement: "1st",
      amount: "50000.00",
      currency: "PKR",
      sponsor: "MalikTech",
    })
    expect(captured.limit).toBe(20)
  })

  it("discloses nothing for a tournament with no approved prizes", async () => {
    captured.rows = []
    expect(await readPublishedTournamentPrizes("t1", "tt1")).toEqual([])
  })
})

describe("prize management card copy (PUB-05 truthfulness)", () => {
  it("labels amounts exactly and non-cash prizes truthfully", () => {
    expect(prizeAmountLabel("50000.00", "PKR")).toBe("PKR 50000.00")
    expect(prizeAmountLabel(null, "PKR")).toBe("Non-cash prize")
  })

  it("badges drafts and frozen approved rows distinctly", () => {
    expect(prizeStatusBadge("draft")).toBe("Draft")
    expect(prizeStatusBadge("approved")).toBe("Approved — frozen")
  })

  it("payout copy says recorded and never claims verification", () => {
    expect(prizePayoutLabel(null)).toBe("Payout not recorded")
    expect(prizePayoutLabel(new Date())).toBe("Payout recorded by the league")
    expect(PRIZE_MANAGER_LABELS.payoutRecordedLabel).toContain("recorded")
    expect(PRIZE_MANAGER_LABELS.approvedBadge).toContain("frozen")
    expect(PRIZE_MANAGER_LABELS.payoutTruth).toContain("does not verify payments")
    // The whole label set must never present a payout record as a verified
    // platform payment.
    for (const value of Object.values(PRIZE_MANAGER_LABELS)) {
      expect(value.toLowerCase()).not.toContain("verified payment")
    }
  })

  it("correction copy never claims to edit the frozen record", () => {
    expect(PRIZE_MANAGER_LABELS.correct).toBe("Correct")
    expect(PRIZE_MANAGER_LABELS.correctingNotice).toContain("never edit the frozen record")
    expect(PRIZE_MANAGER_LABELS.correctingNotice).toContain("superseded")
    expect(PRIZE_MANAGER_LABELS.successCorrected).toContain("approve it to replace")
    expect(PRIZE_MANAGER_LABELS.saveCorrection).toContain("correction draft")
  })

  it("offers a small fixed currency list with PKR first", () => {
    expect(PRIZE_CURRENCY_OPTIONS[0]).toBe("PKR")
    for (const code of PRIZE_CURRENCY_OPTIONS) {
      expect(code).toMatch(/^[A-Z]{3}$/)
    }
  })
})
