import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 142 (resilience): `scoring-storage` is the highest-stakes state in
 * the product — the scorer's unconfirmed local view of a LIVE match — and
 * it was the least-defended. The audit confirmed two failure modes:
 *
 *  1. Corrupt/truncated JSON → zustand swallows the parse error and
 *     silently rehydrates defaults: the scorer's work vanishes from the UI
 *     with no signal at all.
 *  2. VALID JSON with drifted shape (e.g. `innings1` without `balls`,
 *     which any schema drift or partial writer can produce) hydrates
 *     straight through the default shallow merge, and the NEXT delivery
 *     throws TypeError at `innings.balls.filter(...)` with no segment
 *     error boundary to catch it. A scorer is then stuck mid-innings with
 *     a blank screen.
 *
 * The fix follows the repo's own model (`lib/form-drafts.ts` — versioned,
 * shape-checked, EVERY failure mode enumerated): a pure, fail-closed
 * sanitizer between storage and the store. Per-field, not whole-state:
 * one corrupt innings resets THAT innings (the server read re-hydrates
 * it); everything the sanitizer can vouch for survives.
 */

vi.hoisted(() => {
  const storage = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).__scoringStorageMap = storage
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
})
// The SAME map the hoisted stub's closure reads — a separate module-level
// map would silently seed nothing (the store would hydrate defaults and
// every assertion would pass vacuously).
const storageMap = (globalThis as Record<string, unknown>).__scoringStorageMap as Map<string, string>

/** Seeds `scoring-storage` the way a real client would have written it. */
function seedPersisted(partial: Record<string, unknown>, version = 0): void {
  storageMap.set("scoring-storage", JSON.stringify({ state: partial, version }))
}

function validInnings(teamId = "team-a"): Record<string, unknown> {
  return {
    inningsId: "innings-1", teamId, totalRuns: 42, totalWickets: 2, totalBalls: 60,
    extras: 3, byes: 0, legByes: 1, wides: 2, noBalls: 0, status: "in_progress",
    currentOver: 10, currentBall: 0,
    balls: [{ id: "ball-1" }, { id: "ball-2", input: 1, runs: 1 }] as unknown[],
  }
}

describe("sanitizePersistedScoring (Batch 142)", () => {
  it("a fully valid persisted state round-trips unchanged — nothing is lost", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    const partial = {
      matchId: "match-1", queueScopeKey: "scope-1", handoverEpoch: 4, scoringRevision: 8,
      currentInnings: 2, innings1: validInnings("team-x"), innings2: validInnings("team-y"),
      superOver: null,
      innings1History: { history: [], historyIndex: 0 },
      innings2History: { history: [], historyIndex: 1 },
      superOverHistory: { history: [], historyIndex: 0 },
    }
    expect(sanitizePersistedScoring(partial)).toEqual(partial)
  })

  it("drifted shape fails CLOSED per field: the corrupt innings resets, valid siblings survive", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    const out = sanitizePersistedScoring({
      matchId: "match-1",
      innings1: { teamId: "team-a", totalRuns: 42 }, // no balls → the crash state
      innings2: validInnings("team-b"),
    })
    expect(out.matchId).toBe("match-1")
    expect(out.innings1).toBeNull()
    expect((out.innings2 as Record<string, unknown>).teamId).toBe("team-b")
  })

  it("a corrupt ball entry (not an object, no string id) disqualifies the whole innings", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    const innings = validInnings()
    ;(innings.balls as unknown[])[1] = "garbage"
    const out = sanitizePersistedScoring({ innings1: innings })
    // A mid-story delivery that cannot be vouched for voids the innings:
    // the local record must be exactly trustworthy or gone (the server read
    // re-hydrates authoritative state).
    expect(out.innings1).toBeNull()
  })

  it("non-finite or negative counters are rejected — NaN is not a score", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    const innings = { ...validInnings(), totalRuns: Number.NaN }
    expect(sanitizePersistedScoring({ innings1: innings }).innings1).toBeNull()
    const negative = { ...validInnings(), totalBalls: -1 }
    expect(sanitizePersistedScoring({ innings1: negative }).innings1).toBeNull()
    expect(sanitizePersistedScoring({ handoverEpoch: Number.NaN }).handoverEpoch).toBeUndefined()
  })

  it("scalar metadata fails closed to resets, never to invented values", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    const out = sanitizePersistedScoring({ currentInnings: 99, matchId: 42, queueScopeKey: 7, handoverEpoch: "x" })
    expect(out.currentInnings).toBe(1)
    expect(out.matchId).toBe("")
    expect(out.queueScopeKey).toBeUndefined()
    expect(out.handoverEpoch).toBeUndefined()
  })

  it("histories must be well-formed {history, historyIndex}; garbage history never hydrates", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    expect(sanitizePersistedScoring({ innings1History: [] }).innings1History).toEqual({ history: [], historyIndex: 0 })
    expect(sanitizePersistedScoring({ superOverHistory: { history: "x", historyIndex: 0 } }).superOverHistory)
      .toEqual({ history: [], historyIndex: 0 })
    expect(sanitizePersistedScoring({ innings2History: { history: [], historyIndex: Number.NaN } }).innings2History)
      .toEqual({ history: [], historyIndex: 0 })
  })

  it("grossly malformed persistence (null, strings) yields an empty patch — defaults win", async () => {
    const { sanitizePersistedScoring } = await import("../lib/scoring-storage-integrity")
    expect(sanitizePersistedScoring(null)).toEqual({})
    expect(sanitizePersistedScoring("corrupt")).toEqual({})
  })
})

describe("CORRUPT persistence integration (Batch 142)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    storageMap.clear()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("truncated JSON: rehydrate does not throw, the store stays usable, and the loss is ANNOUNCED", async () => {
    storageMap.set("scoring-storage", '{"state":{"matchId":"match-1","innings1":{"inningsId"')
    const { useScoringStore } = await import("../stores/scoring-store")
    await expect(useScoringStore.persist.rehydrate()).resolves.not.toThrow()
    // The scorer sees WHY their view reset — never a silent wipe.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[scoring-storage]"), expect.any(SyntaxError))
    // And the store still records a delivery (no TypeError from a half state).
    expect(() => {
      useScoringStore.setState({ matchId: "match-1" })
      useScoringStore.getState().addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1, isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    }).not.toThrow()
  })

  it("valid JSON, drifted shape: the store survives the NEXT delivery (the crash mode)", async () => {
    seedPersisted({ matchId: "match-9", innings1: { teamId: "team-a", totalRuns: 42 }, currentInnings: 1 })
    const { useScoringStore } = await import("../stores/scoring-store")
    await useScoringStore.persist.rehydrate()
    expect(useScoringStore.getState().innings1).toBeNull()
    expect(() => {
      useScoringStore.getState().addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1, isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    }).not.toThrow()
  })

  it("an unversioned payload with valid shape migrates IN — real local work survives the upgrade", async () => {
    seedPersisted({ matchId: "match-2", innings1: validInnings("team-b"), currentInnings: 1 })
    const { useScoringStore } = await import("../stores/scoring-store")
    await useScoringStore.persist.rehydrate()
    // Version bump (0 → 1) may not destroy the work it was meant to protect.
    expect(useScoringStore.getState().innings1?.teamId).toBe("team-b")
    expect(useScoringStore.getState().matchId).toBe("match-2")
  })

  it("wrong-shape writes never persist a corrupt innings back out", async () => {
    seedPersisted({ matchId: "match-3", innings1: { teamId: "x" } })
    const { useScoringStore } = await import("../stores/scoring-store")
    await useScoringStore.persist.rehydrate()
    const saved = JSON.parse(storageMap.get("scoring-storage")!)
    expect(saved.version).toBe(1)
    expect(saved.state.innings1).toBeNull()
    expect(saved.state.matchId).toBe("match-3")
  })
})
