import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 143 (resilience): the audit's #2 and #3 findings — the live-scoring
 * route is the one surface where a transient failure should never blank
 * the screen.
 *
 *  - The three chart chunks load `next/dynamic(...).then()` with NO
 *    rejection handling: one failed chunk fetch on a weak connection
 *    (a scorer's normal environment) throws at render — and with no
 *    segment error boundary it escapes to the ROOT error page, replacing
 *    the whole scorer. Charts are decoration; scoring is the product.
 *  - The scoring segment has loading.tsx but NO error.tsx at all.
 *  - The scope switch's quarantine write has no guard despite its own
 *    comment ("Failure ... MUST stop the switch"): today it stops by
 *    ACCIDENT with a raw QuotaExceededError surfacing as a generic load
 *    failure. It stops ON PURPOSE now, with an honest typed message.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, "..")
const scoringPage = () => readFileSync(join(WEB_SRC, "app/matches/[matchId]/scoring/page.tsx"), "utf8")

describe("Scoring route resilience (Batch 143)", () => {
  beforeEach(() => {
    // Each scenario re-imports activate-scoring-scope with ITS OWN store
    // mock; without a registry reset the second test would silently act on
    // the first test's state object.
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it("all three chart chunks degrade to a stated fallback — a failed chart never kills the scorer", () => {
    const source = scoringPage()
    expect((source.match(/\.catch\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(source).toContain("ChartLoadFailure")
  })

  it("the scoring segment HAS its own error boundary", () => {
    expect(existsSync(join(WEB_SRC, "app/matches/[matchId]/scoring/error.tsx"))).toBe(true)
  })

  it("the segment boundary speaks scorer-truth: confirmed work is safe, and says what to do", async () => {
    const { default: ScoringError } = await import("../app/matches/[matchId]/scoring/error")
    const html = renderToStaticMarkup(
      React.createElement(ScoringError, { error: Object.assign(new Error("boom"), { digest: "dig-1" }), reset: () => {} }),
    )
    expect(html).toContain("Try again")
    expect(html).toContain("dig-1")
    expect(html).toMatch(/recorded/i)
    expect(html).toMatch(/safe on the server/)
    expect(html).not.toMatch(/undefined/)
  })

  it("the scope switch's quarantine write stops the switch ON PURPOSE, typed and honest", async () => {
    // Storage that has hit its quota.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new DOMException("quota", "QuotaExceededError") },
      removeItem: () => {},
    })
    const state = { queueScopeKey: "old-scope", matchId: "match-1", setMatchId: (v: string) => { state.matchId = v } }
    const storeMock = {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => { Object.assign(state, patch) },
    }
    vi.doMock("../stores/scoring-store", () => ({ useScoringStore: storeMock }))
    const { activateScoringScope } = await import("../lib/activate-scoring-scope")
    expect(() => activateScoringScope({ accountId: "acc", tenantId: "t-1", matchId: "match-2" } as never))
      .toThrowError(/view aside/)
    // The switch did not happen: nothing was discarded, nothing adopted.
    expect(state.matchId).toBe("match-1")
    expect(state.queueScopeKey).toBe("old-scope")
    vi.doUnmock("../stores/scoring-store")
    vi.unstubAllGlobals()
  })

  it("the quarantine guard resets the conversation: a clean switch still works", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (_key: string, value: string) => { expect(value).toContain("match-1") },
      removeItem: () => {},
    })
    const state = { queueScopeKey: "old", matchId: "match-1", setMatchId: (v: string) => { state.matchId = v } }
    const storeMock = {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => { Object.assign(state, patch) },
    }
    vi.doMock("../stores/scoring-store", () => ({ useScoringStore: storeMock }))
    const { activateScoringScope } = await import("../lib/activate-scoring-scope")
    activateScoringScope({ accountId: "acc", tenantId: "t-1", matchId: "match-2" } as never)
    expect(state.queueScopeKey).toBe(JSON.stringify(["acc", "t-1", "match-2"]))
    vi.doUnmock("../stores/scoring-store")
    vi.unstubAllGlobals()
  })
})

describe("scope-key shape guard for the quarantine test (Batch 143)", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("pins the real scoringQueueKey output the switch test relies on", async () => {
    const { scoringQueueKey } = await import("../lib/scoring-queue-scope")
    expect(scoringQueueKey({ accountId: "acc", tenantId: "t-1", matchId: "match-2" } as never))
      .toBe(JSON.stringify(["acc", "t-1", "match-2"]))
  })
})
