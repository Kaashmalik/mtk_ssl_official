import { describe, expect, it } from "vitest"
import { xiCanDeclare, xiDeclarationFromSlots, xiGateStatus, xiInitialSlots, xiStatusLabel,
  type ActiveXiPlayer } from "@/lib/xi-card"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = (start: number) => Array.from({ length: 11 }, (_, i) => T(start + i))

describe("Playing-XI card derivations (COMP-06 slice)", () => {
  it("mirrors the shared policy gate: off unless armed, armed means pending until approved", () => {
    expect(xiGateStatus({})).toBe("notDeclared")
    expect(xiGateStatus({ xiRequired: false })).toBe("notDeclared")
    expect(xiGateStatus({ xiRequired: true, xiApprovedAt: null })).toBe("pendingApproval")
    expect(xiGateStatus({ xiRequired: true })).toBe("pendingApproval")
    expect(xiGateStatus({ xiRequired: true, xiApprovedAt: "not-a-date" })).toBe("pendingApproval")
    expect(xiGateStatus({ xiRequired: true, xiApprovedAt: new Date(Date.now() - 1_000) })).toBe("approved")
  })

  it("labels states with exact copy, including the approval date", () => {
    expect(xiStatusLabel("notDeclared")).toBe("Playing XIs not declared yet")
    expect(xiStatusLabel("pendingApproval")).toBe("Declared — awaiting official approval")
    expect(xiStatusLabel("approved")).toBe("Officially approved")
    expect(xiStatusLabel("approved", new Date("2026-10-17T09:00:00Z"))).toBe("Officially approved (Oct 17)")
    expect(xiStatusLabel("approved", "2026-10-17T09:00:00Z")).toBe("Officially approved (Oct 17)")
    expect(xiStatusLabel("approved", "garbage")).toBe("Officially approved")
  })

  it("validates the exactly-11 distinct selection before calling the writer", () => {
    const players = P(100)
    expect(xiDeclarationFromSlots(players, "Team A")).toEqual({
      entries: players.map((playerId, i) => ({ playerId, battingOrder: i + 1 })),
      error: null,
    })
    expect(xiDeclarationFromSlots(players.slice(0, 10), "Team A").error).toBe("Team A needs exactly 11 slots")
    expect(xiDeclarationFromSlots([...players, T(199)], "Team A").error).toBe("Team A needs exactly 11 slots")
    expect(xiDeclarationFromSlots(players.map((p, i) => (i === 3 ? null : p)), "Team A").error)
      .toBe("Team A needs all 11 players selected")
    expect(xiDeclarationFromSlots(players.map((p, i) => (i === 3 ? players[5] : p)), "Team A").error)
      .toBe("Team A cannot select the same player twice")
  })

  it("declaration is competition-only and pre-match only", () => {
    expect(xiCanDeclare({ status: "scheduled", tournamentId: T(10) })).toBe(true)
    expect(xiCanDeclare({ status: "scheduled", tournamentId: null })).toBe(false)
    expect(xiCanDeclare({ status: "scheduled", tournamentId: undefined })).toBe(false)
    expect(xiCanDeclare({ status: "live", tournamentId: T(10) })).toBe(false)
    expect(xiCanDeclare({ status: null, tournamentId: T(10) })).toBe(false)
  })

  it("prefills slots from the active declared XI sorted by batting order, else empty", () => {
    const declared: ActiveXiPlayer[] = P(200).map((playerId, i) => ({ playerId, battingOrder: 11 - i, name: `P${i}` }))
    expect(xiInitialSlots(declared)).toEqual([...P(200)].reverse())
    expect(xiInitialSlots(declared.slice(0, 10))).toHaveLength(11)
    expect(xiInitialSlots(declared.slice(0, 10)).every(slot => slot === null)).toBe(true)
    expect(xiInitialSlots()).toEqual(Array.from({ length: 11 }, () => null))
  })
})
