import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatchSummaryPrompt, generateMatchSummaryAi, matchSummaryAiReady } from "@/lib/match-summary-ai"
import type { MatchRecap } from "@mtk/database/lib/match-recap"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const RECAP: MatchRecap = {
  summary: "Team A beat Team B. Scores: 160/6 (20.0), 141 all out (18.3).",
  topBatters: [{ playerName: "A. Khan", teamName: "Team A", runs: 62, balls: 40 }],
  topBowlers: [{ playerName: "R. Ali", teamName: "Team B", wickets: 3, runs: 21, overs: "4" }],
  moments: [{ kind: "fifty", playerName: "A. Khan", detail: "50 off 33 balls" }],
}

describe("FAN-04 (B163): gated, labeled AI match summary", () => {
  it("exists only when BOTH the flag and the provider key are configured", () => {
    vi.stubEnv("MATCH_SUMMARY_AI_READY", "true")
    expect(matchSummaryAiReady()).toBe(false) // no key
    vi.stubEnv("COMMENTARY_AI_API_KEY", "key")
    expect(matchSummaryAiReady()).toBe(true)
    vi.stubEnv("MATCH_SUMMARY_AI_READY", "false")
    expect(matchSummaryAiReady()).toBe(false)
  })

  it("the prompt contains ONLY the deterministic recap facts and forbids invention", () => {
    const prompt = buildMatchSummaryPrompt(RECAP)
    expect(prompt).toContain(RECAP.summary)
    expect(prompt).toContain("A. Khan 62 (40b)")
    expect(prompt).toContain("R. Ali 3/21")
    expect(prompt).toContain("never invent players, events, partnerships, or outcomes")
    // NoXi: no fabricated facts appear that are not in the recap.
    expect(prompt).not.toContain("won by 5 wickets")
  })

  it("degrades to unavailable on provider failure - never an unlabeled paragraph", async () => {
    vi.stubEnv("MATCH_SUMMARY_AI_READY", "true")
    vi.stubEnv("COMMENTARY_AI_API_KEY", "key")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const result = await generateMatchSummaryAi(RECAP)
    expect(result).toEqual({ text: null, source: "unavailable" })
  })

  it("returns the model text labeled ai when the provider and gates allow", async () => {
    vi.stubEnv("MATCH_SUMMARY_AI_READY", "true")
    vi.stubEnv("COMMENTARY_AI_API_KEY", "key")
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Team A edged Team B in a game decided late." } }] }),
    })))
    const result = await generateMatchSummaryAi(RECAP)
    expect(result.source).toBe("ai")
    if (result.source === "ai") {
      expect(result.text).toContain("Team A edged Team B")
      expect(result.text.length).toBeLessThanOrEqual(900)
    }
  })

  it("never attempts a provider call while ungated", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const result = await generateMatchSummaryAi(RECAP)
    expect(result.source).toBe("unavailable")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
