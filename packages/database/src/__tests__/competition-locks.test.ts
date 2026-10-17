import { describe, expect, it } from "vitest"
import { competitionLocked, competitionLockBlocks, lockScopedTournamentIds } from "../lib/competition-locks"

const AT = new Date("2026-10-17T00:00:00Z")

describe("competitionLocked (fail-closed, explicit engagement only)", () => {
  it("locks only on an explicitly engaged instant", () => {
    expect(competitionLocked({ competitionLockedAt: AT })).toBe(true)
    expect(competitionLocked({ competitionLockedAt: null })).toBe(false)
  })

  it("treats an unknown (partial) read as locked — unknown never opens a gate", () => {
    expect(competitionLocked({ competitionLockedAt: undefined as unknown as Date | null })).toBe(true)
  })
})

describe("competitionLockBlocks (broadcast stays available)", () => {
  it("blocks every fixture edit", () => {
    expect(competitionLockBlocks("create")).toBe(true)
    expect(competitionLockBlocks("update")).toBe(true)
    expect(competitionLockBlocks("cancel")).toBe(true)
    expect(competitionLockBlocks("reschedule")).toBe(true)
  })

  it("never blocks broadcast controls", () => {
    expect(competitionLockBlocks("stream-start")).toBe(false)
    expect(competitionLockBlocks("stream-end")).toBe(false)
  })
})

describe("lockScopedTournamentIds", () => {
  it("keeps every distinct tournament id the write touches, in order", () => {
    expect(lockScopedTournamentIds([null, "a", undefined, "b", "a"])).toEqual(["a", "b"])
  })

  it("drops nothing else and yields empty for detached fixtures", () => {
    expect(lockScopedTournamentIds([null, undefined])).toEqual([])
  })
})
