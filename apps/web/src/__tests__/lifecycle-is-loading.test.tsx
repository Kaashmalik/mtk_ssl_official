import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React, { type ReactNode } from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 140: the lifecycle controls adopt the shared `isLoading` idiom
 * Batch 139 put into the primitive. They were the proof-of-need for it:
 * "Set Toss" hand-rolled an icon→spinner swap while "Start Match" and
 * "End Match" went silently disabled — on ONE panel, a pending write was
 * visible on one button and invisible on the other two. Adoption gives
 * all three the SAME pending contract (spinner + disabled + aria-busy)
 * and deletes the last hand-rolled spinner in this surface.
 *
 * The non-action affordances (Open/Continue Scoring) are deliberately
 * NOT busy: navigation is not a write. The source pin holds the
 * adoption; the renders hold the observable contract through the REAL
 * primitive (only transition/router/toast/actions/select are mocked).
 */

const mocks = vi.hoisted(() => ({ isPending: false }))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useTransition: () => [mocks.isPending, (cb: () => unknown) => Promise.resolve(cb())],
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock("@/app/actions/matches", () => ({
  setTossResult: () => Promise.resolve({ success: true }),
  startMatch: () => Promise.resolve({ success: true }),
  endMatch: () => Promise.resolve({ success: true }),
}))
vi.mock("@mtk/ui/components/ui/select", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Select: Wrapper, SelectContent: Wrapper, SelectItem: Wrapper, SelectTrigger: Wrapper, SelectValue: Wrapper }
})

beforeEach(() => {
  vi.stubGlobal("React", React)
  mocks.isPending = false
})
afterEach(() => vi.unstubAllGlobals())

async function renderFor(status: "toss" | "live"): Promise<string> {
  const { MatchLifecycleControls } = await import("../components/matches/match-lifecycle-controls")
  return renderToStaticMarkup(
    <MatchLifecycleControls
      matchId="match" status={status}
      teamA={{ id: "a", name: "Team A" }} teamB={{ id: "b", name: "Team B" }}
    />,
  )
}

describe("Lifecycle controls adopt isLoading (Batch 140)", () => {
  it("pending on the toss panel: both write controls busy, navigation not", async () => {
    mocks.isPending = true
    const html = await renderFor("toss")
    // The REAL primitive renders the pending contract: spinner + disabled
    // + aria-busy on Set Toss AND Start Match (Start Match was previously
    // a silent disable — the inconsistency this batch closes).
    expect((html.match(/aria-busy="true"/g) ?? []).length).toBe(2)
    expect((html.match(/animate-spin/g) ?? []).length).toBe(2)
    expect((html.match(/\sdisabled="/g) ?? []).length).toBe(2)
    // "Open Live Scoring" is not a write: stays enabled, not busy.
    expect(html).toContain("Open Live Scoring")
    const scoringButton = html.slice(html.indexOf("Open Live Scoring") - 400, html.indexOf("Open Live Scoring"))
    expect(scoringButton).not.toMatch(/aria-busy/)
  })

  it("pending on the live panel: End Match busy, Continue Scoring not", async () => {
    mocks.isPending = true
    const html = await renderFor("live")
    expect((html.match(/aria-busy="true"/g) ?? []).length).toBe(1)
    expect((html.match(/animate-spin/g) ?? []).length).toBe(1)
    expect(html).toContain("End Match")
    expect(html).toContain("Continue Scoring")
  })

  it("not pending: no busy announcement, no spinner, nothing disabled", async () => {
    const html = await renderFor("toss")
    expect(html).not.toMatch(/aria-busy/)
    expect(html).not.toContain("animate-spin")
  })

  it("the adoption is real: the hand-rolled spinner swap is gone from source", () => {
    const source = readFileSync(join(__dirname, "../components/matches/match-lifecycle-controls.tsx"), "utf8")
    expect((source.match(/isLoading=\{isPending\}/g) ?? []).length).toBe(3)
    expect(source).not.toContain("disabled={isPending}")
    expect(source).not.toContain("Loader2")
  })
})
