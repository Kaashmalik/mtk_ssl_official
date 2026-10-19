import type { MatchRecap } from "@mtk/database/lib/match-recap"

/**
 * FAN-04 (B163): the gated, labeled AI match summary — the clause B143 left
 * open ("any future AI/prediction feature stays unbuilt and gated rather
 * than a label pretending review").
 *
 * Rules, pinned:
 * - The feature EXISTS only when MATCH_SUMMARY_AI_READY=true AND a provider
 *   key is configured; otherwise nothing renders and no provider call is
 *   ever attempted (the page ships no client code at all).
 * - The model receives ONLY the deterministic recap fold of official rows
 *   (the same facts the recap card shows). It may rearrange and phrase them;
 *   it may never change a score, invent a player, or declare a winner
 *   beyond the echoed result text.
 * - The output is ALWAYS rendered with the AI label and the existing
 *   never-fabricated notice attached; no provider response is ever treated
 *   as an official record.
 * - A provider failure degrades to the deterministic recap line, clearly
 *   labeled "derived" — never to an unlabeled paragraph.
 */

export function matchSummaryAiReady(): boolean {
  return (
    process.env.MATCH_SUMMARY_AI_READY === "true" &&
    Boolean(process.env.COMMENTARY_AI_API_KEY?.trim())
  )
}

export type MatchSummaryAi =
  | { text: string; source: "ai" }
  | { text: null; source: "unavailable" }

const MAX_SUMMARY_CHARS = 900

export function buildMatchSummaryPrompt(recap: MatchRecap): string {
  const facts: string[] = [recap.summary]
  if (recap.topBatters.length > 0) {
    facts.push(`Top batters: ${recap.topBatters.map((b) => `${b.playerName} ${b.runs} (${b.balls}b)`).join("; ")}`)
  }
  if (recap.topBowlers.length > 0) {
    facts.push(`Top bowlers: ${recap.topBowlers.map((b) => `${b.playerName} ${b.wickets}/${b.runs} (${b.overs} ov)`).join("; ")}`)
  }
  if (recap.moments.length > 0) {
    facts.push(`Moments: ${recap.moments.map((m) => `${m.playerName} ${m.detail}`).join("; ")}`)
  }
  return [
    "Write a two-sentence post-match summary paragraph for a league website in plain, neutral English.",
    "Use ONLY the facts below - never invent players, events, partnerships, or outcomes, and never name a winner beyond the stated result.",
    "Do not add commentary about what the match means going forward.",
    "FACTS:",
    facts.join("\n"),
  ].join("\n")
}

async function callSummaryProvider(prompt: string): Promise<string> {
  const apiKey = process.env.COMMENTARY_AI_API_KEY!.trim()
  const baseUrl = (process.env.COMMENTARY_AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "")
  const model = process.env.COMMENTARY_AI_MODEL?.trim() || "gpt-4o-mini"
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      max_tokens: 300,
      messages: [
        { role: "system", content: "You summarise recorded cricket match facts for a league website. Output ONLY the summary paragraph - no headings, no preface, no invented content." },
        { role: "user", content: prompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`summary provider http ${response.status}`)
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = body.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("summary provider returned no content")
  return text.slice(0, MAX_SUMMARY_CHARS)
}

/**
 * Attempts the AI summary; on ANY failure returns unavailable so the caller
 * serves the deterministic recap line instead (still labeled, still honest).
 */
export async function generateMatchSummaryAi(recap: MatchRecap): Promise<MatchSummaryAi> {
  if (!matchSummaryAiReady()) return { text: null, source: "unavailable" }
  try {
    return { text: await callSummaryProvider(buildMatchSummaryPrompt(recap)), source: "ai" }
  } catch {
    return { text: null, source: "unavailable" }
  }
}
