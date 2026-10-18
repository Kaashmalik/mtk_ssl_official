import { describe, expect, it } from "vitest"
import { xiAttachKeeper, xiCanDeclare, xiCanSubstitute, xiDeclarationFromSlots, xiGateStatus,
  xiInitialKeeper, xiInitialSlots, xiStatusLabel, xiSubstitutionSelection, type ActiveXiPlayer } from "@/lib/xi-card"

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

  describe("wicketkeeper designation derivations (PUB-03/COMP-06)", () => {
    const declared: ActiveXiPlayer[] = P(100).map((playerId, i) => ({
      playerId, battingOrder: i + 1, name: `P${i}`, wicketkeeper: i === 2,
    }))

    it("attaches the flag to exactly the designated slot and fails closed on an outsider", () => {
      const base = xiDeclarationFromSlots(P(100), "Team A").entries
      const attached = xiAttachKeeper(base, T(102))
      expect(attached.error).toBeNull()
      expect(attached.entries.filter(entry => entry.wicketkeeper === true)).toEqual([
        { playerId: T(102), battingOrder: 3, wicketkeeper: true },
      ])
      expect(attached.entries).toHaveLength(11)

      expect(xiAttachKeeper(base, null)).toEqual({ entries: base, error: null })
      expect(xiAttachKeeper(base, T(150)).error).toBe("The designated wicketkeeper must be in the declared XI")
    })

    it("prefills the keeper from the declared side and reads no-designation as none", () => {
      expect(xiInitialKeeper(declared)).toBe(T(102))
      expect(xiInitialKeeper(declared.map(p => ({ ...p, wicketkeeper: false })))).toBeNull()
      expect(xiInitialKeeper()).toBeNull()
    })
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

  it("substitution is official in-match business on armed competition XIs", () => {
    expect(xiCanSubstitute({ xiRequired: true, status: "live", tournamentId: T(10) })).toBe(true)
    expect(xiCanSubstitute({ xiRequired: true, status: "innings_break", tournamentId: T(10) })).toBe(true)
    expect(xiCanSubstitute({ xiRequired: false, status: "live", tournamentId: T(10) })).toBe(false)
    expect(xiCanSubstitute({ xiRequired: true, status: "completed", tournamentId: T(10) })).toBe(false)
    expect(xiCanSubstitute({ xiRequired: true, status: "live", tournamentId: null })).toBe(false)
  })

  it("substitution selection mirrors the policy before calling the writer", () => {
    const declared: ActiveXiPlayer[] = P(100).map((playerId, i) => ({ playerId, battingOrder: i + 1, name: `P${i}` }))
    const eligible = [...P(150), ...P(100)].map((id, i) => ({ id, name: `E${i}` }))
    const bare = { outgoingPlayerId: "", incomingPlayerId: "", error: expect.anything() }
    expect(xiSubstitutionSelection(null, null, declared, eligible)).toEqual(bare)
    expect(xiSubstitutionSelection(P(100)[3], null, declared, eligible)).toEqual(bare)
    expect(xiSubstitutionSelection(P(150)[0], P(150)[1], declared, eligible).error)
      .toBe("The outgoing player is not in the declared playing XI")
    expect(xiSubstitutionSelection(P(100)[3], P(100)[5], declared, eligible).error)
      .toBe("The incoming player is already in the declared playing XI")
    expect(xiSubstitutionSelection(P(100)[3], T(999), declared, eligible).error)
      .toBe("The incoming player is not eligible for this side")
    expect(xiSubstitutionSelection(P(100)[3], P(150)[0], declared, eligible)).toEqual({
      outgoingPlayerId: P(100)[3], incomingPlayerId: P(150)[0], error: null,
    })
  })
})
