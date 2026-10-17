import { describe, expect, it } from "vitest"
import { validateDeclaredXi, xiEnforcementLevel, xiIsApproved, xiCoversParticipants,
  PLAYING_XI_SIZE } from "../lib/playing-xi-policy"

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
})
