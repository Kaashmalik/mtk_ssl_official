import React, { type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ScoringRecoveryPanel } from "@/components/scoring/scoring-recovery-panel"

const mocks = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, setters: [] as ReturnType<typeof vi.fn>[],
  buttons: [] as Array<{ label: string; disabled?: boolean; click: () => Promise<void> }>,
  record: vi.fn(), remove: vi.fn(), reload: vi.fn(), confirmed: vi.fn(),
}))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = mocks.cursor++; return [mocks.states[index] ?? initial, mocks.setters[index]] },
}))
vi.mock("@/app/actions/scoring", () => ({ recordBall: mocks.record, getMatchForScoring: vi.fn() }))
vi.mock("@/lib/offline-ball-queue", () => ({ getQueuedBalls: vi.fn(), removeQueuedBall: mocks.remove }))
vi.mock("@mtk/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick: () => Promise<void> }) => {
    mocks.buttons.push({ label: children, disabled, click: onClick })
    return <button disabled={disabled}>{children}</button>
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("React", React)
  vi.stubGlobal("window", { location: { reload: mocks.reload } })
  mocks.cursor = 0
  mocks.buttons.length = 0
  mocks.setters = Array.from({ length: 5 }, () => vi.fn())
  mocks.states = [{ first: { clientOpId: "op", matchId: "match", inningsId: "innings", attempts: 0, queuedAt: 1,
    payload: { matchId: "match", inningsId: "innings", overNumber: 0, ballNumber: 1, runs: 1, handoverEpoch: 1, expectedRevision: 2 } },
    snapshot: { canScore: true, match: { id: "match", handoverEpoch: 3, scoringRevision: 7 },
      innings: [{ id: "innings", totalRuns: 0, totalWickets: 0, totalBalls: 0 }] } },
  "Compared against the official score", true, false, undefined]
  mocks.record.mockResolvedValue({ success: true, ballId: "canonical", clientOpId: "op", scoringRevision: 8 })
  mocks.remove.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

function render() {
  const html = renderToStaticMarkup(<ScoringRecoveryPanel matchId="match" onConfirmed={mocks.confirmed} />)
  return { html, button: mocks.buttons.find(button => button.label === "Confirm reviewed retry")! }
}

describe("Saved delivery review controls (stubbed, not browser acceptance)", () => {
  it("requires explicit confirmation before enabling the reviewed retry", () => {
    mocks.states[2] = false
    const { html, button } = render()
    expect(html).toContain("Review reason")
    expect(html).toContain("original identity and position")
    expect(button.disabled).toBe(true)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it("acknowledges canonical success before removing only the reviewed operation", async () => {
    const { button } = render()
    expect(button.disabled).toBe(false)
    await button.click()
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ clientOpId: "op", handoverEpoch: 3, expectedRevision: 7,
      overNumber: 0, ballNumber: 1, review: { reason: "Compared against the official score", previousEpoch: 1, previousRevision: 2 } }))
    expect(mocks.confirmed.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0])
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("op")
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it("retains saved work when the reviewed snapshot loses a race", async () => {
    mocks.record.mockResolvedValue({ success: false, code: "SCORING_REVISION_CONFLICT", currentRevision: 8,
      message: "The official score changed again" })
    await render().button.click()
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.confirmed).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(mocks.setters[4]).toHaveBeenCalledWith("The official score changed again")
  })
})
