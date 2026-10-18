import { describe, expect, it } from "vitest"
import { validateDeclaredXi, xiEnforcementLevel, xiIsApproved, xiCoversParticipants,
  xiSubstitutionOrder, entryIsWicketkeeper, PLAYING_XI_SIZE } from "../lib/playing-xi-policy"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const TEAM_A = T(21)
const TEAM_B = T(22)

const declared = (start: number) => Array.from({ length: 11 }, (_, i) => ({ playerId: T(start + i), battingOrder: i + 1 }))

describe("Shared playing-XI policy (COMP-06)", () => {
  it("requires exactly eleven distinct players with orders 1..11", () => {
    expect(() => validateDeclaredXi(declared(100), TEAM_A)).not.toThrow()
    expect(() => validateDeclaredXi(declared(100).slice(0, 10), TEAM_A)).toThrow("exactly 11 players")
    const duplicateOrder = declared(100)
    duplicateOrder[10] = { ...duplicateOrder[10], battingOrder: 1 }
    expect(() => validateDeclaredXi(duplicateOrder, TEAM_A)).toThrow("declared a batting order twice")
    const duplicatePlayer = declared(100)
    duplicatePlayer[10] = { playerId: duplicatePlayer[0].playerId, battingOrder: 11 }
    expect(() => validateDeclaredXi(duplicatePlayer, TEAM_A)).toThrow("declared a player twice")
    expect(() => validateDeclaredXi(declared(100).map(e => ({ ...e, battingOrder: 0 })), TEAM_A))
      .toThrow("batting orders must be 1..11")
    expect(() => validateDeclaredXi(declared(100).map(e => ({ ...e, battingOrder: 2.5 })), TEAM_A))
      .toThrow("batting orders must be 1..11")
    expect(PLAYING_XI_SIZE).toBe(11)
  })

  describe("wicketkeeper designation (PUB-03/COMP-06)", () => {
    it("accepts zero or one designated keeper and refuses a second", () => {
      const withKeeper = declared(100).map((e, i) => (i === 0 ? { ...e, wicketkeeper: true } : e))
      expect(() => validateDeclaredXi(withKeeper, TEAM_A)).not.toThrow()
      expect(() => validateDeclaredXi(declared(100), TEAM_A)).not.toThrow()

      const twoKeepers = declared(100).map((e, i) => (i === 0 || i === 1 ? { ...e, wicketkeeper: true } : e))
      expect(() => validateDeclaredXi(twoKeepers, TEAM_A)).toThrow("cannot designate more than one wicketkeeper")
    })

    it("treats anything but an explicit true as non-keeper (fail-safe legacy rows)", () => {
      expect(entryIsWicketkeeper({ wicketkeeper: true })).toBe(true)
      expect(entryIsWicketkeeper({})).toBe(false)
      expect(entryIsWicketkeeper({ wicketkeeper: false })).toBe(false)
      expect(entryIsWicketkeeper({ wicketkeeper: undefined })).toBe(false)
    })
  })

  it("enforcement is legacy-safe: off unless the requirement is armed", () => {
    expect(xiEnforcementLevel({})).toBe("off")
    expect(xiEnforcementLevel({ xiRequired: false })).toBe("off")
    expect(xiEnforcementLevel({ xiRequired: null })).toBe("off")
  })

  it("armed matches fail closed: malformed, absent or future approval never reads as approved", () => {
    expect(xiEnforcementLevel({ xiRequired: true, xiApprovedAt: null })).toBe("pendingApproval")
    expect(xiEnforcementLevel({ xiRequired: true })).toBe("pendingApproval")
    expect(xiEnforcementLevel({ xiRequired: true, xiApprovedAt: "not-a-date" })).toBe("pendingApproval")
    expect(xiEnforcementLevel({ xiRequired: true, xiApprovedAt: new Date(Date.now() + 60_000) }))
      .toBe("pendingApproval")
    expect(xiEnforcementLevel({ xiRequired: true, xiApprovedAt: new Date(Date.now() - 1_000) }))
      .toBe("enforced")
    expect(xiIsApproved({ xiRequired: true, xiApprovedAt: "2026-10-17T08:00:00.000Z" },
      new Date("2026-10-17T09:00:00.000Z"))).toBe(true)
    expect(xiIsApproved({ xiRequired: true, xiApprovedAt: "2026-10-17T09:00:00.000Z" },
      new Date("2026-10-17T08:00:00.000Z"))).toBe(false)
  })

  it("coverage fails closed on missing, partial or duplicated declared sides", () => {
    const rows = [...declared(100).map(e => ({ ...e, teamId: TEAM_A })), ...declared(200).map(e => ({ ...e, teamId: TEAM_B }))]
    const participants = new Map([[T(100), TEAM_A], [T(200), TEAM_B]])
    expect(xiCoversParticipants(rows, participants)).toBe(true)

    expect(xiCoversParticipants([], participants)).toBe(false)
    // Missing participant.
    expect(xiCoversParticipants(rows.filter(row => row.playerId !== T(200)), participants)).toBe(false)
    // A side below 11 active players.
    expect(xiCoversParticipants(rows.slice(0, 16), participants)).toBe(false)
    // A duplicated active row for the same player and order is corrupt data.
    expect(xiCoversParticipants([...rows, { teamId: TEAM_A, playerId: T(100), battingOrder: 1 }], participants))
      .toBe(false)
  })

  it("coverage requires each participant's OWN side, not merely any side", () => {
    const rows = [...declared(100).map(e => ({ ...e, teamId: TEAM_A })), ...declared(200).map(e => ({ ...e, teamId: TEAM_B }))]
    expect(xiCoversParticipants(rows, new Map([[T(100), TEAM_B]]))).toBe(false)
    expect(xiCoversParticipants(rows, new Map([[T(300), TEAM_A]]))).toBe(false)
  })

  describe("XI substitution (SCORE-10)", () => {
    const rows = [...declared(100).map(e => ({ ...e, teamId: TEAM_A })), ...declared(200).map(e => ({ ...e, teamId: TEAM_B }))]

    it("returns the outgoing player's order so the replacement inherits the slot", () => {
      expect(xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: T(103), incomingPlayerId: T(150) })).toBe(4)
  })

    it("fails closed on unknown, duplicate, cross-side or self replacements", () => {
      expect(() => xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: T(150), incomingPlayerId: T(151) }))
        .toThrow("not in the declared playing XI")
      expect(() => xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: T(103), incomingPlayerId: T(105) }))
        .toThrow("already in the declared playing XI")
      expect(() => xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: T(103), incomingPlayerId: T(203) }))
        .toThrow("declared for the other side")
      expect(() => xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: T(103), incomingPlayerId: T(103) }))
        .toThrow("two different players")
      expect(() => xiSubstitutionOrder({ activeRows: rows, teamId: TEAM_A, outgoingPlayerId: "", incomingPlayerId: T(150) }))
        .toThrow("outgoing and an incoming player")
    })
  })
})
