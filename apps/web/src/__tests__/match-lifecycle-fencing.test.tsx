import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React, { Children, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MatchLifecycleControls } from "@/components/matches/match-lifecycle-controls"
import { HANDOVER_RESYNC_COPY } from "@/lib/scoring-fence"

const mocks = vi.hoisted(() => ({
  complete: vi.fn(), success: vi.fn(), error: vi.fn(), refresh: vi.fn(),
  buttons: [] as Array<{ label: string; click: () => void }>,
  pending: [] as Promise<unknown>[],
}))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useTransition: () => [false, (callback: () => unknown) => { mocks.pending.push(Promise.resolve(callback())) }],
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock("@/app/actions/matches", () => ({ endMatch: mocks.complete, setTossResult: vi.fn(), startMatch: vi.fn() }))
vi.mock("@mtk/ui/components/ui/button", () => ({ Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
  if (onClick) mocks.buttons.push({ label: Children.toArray(children).filter(value => typeof value === "string").join("").trim(), click: onClick })
  return <button>{children}</button>
} }))
vi.mock("@mtk/ui/components/ui/select", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Select: Wrapper, SelectContent: Wrapper, SelectItem: Wrapper, SelectTrigger: Wrapper, SelectValue: Wrapper }
})

beforeEach(() => {
  // Vitest's JSX transform is classic; the application uses Next's transform.
  vi.stubGlobal("React", React)
  vi.clearAllMocks()
  mocks.buttons.length = 0
  mocks.pending.length = 0
  mocks.complete.mockResolvedValue({ success: true })
})
afterEach(() => vi.unstubAllGlobals())

function render(epoch?: number) {
  renderToStaticMarkup(<MatchLifecycleControls matchId="match" status="live" handoverEpoch={epoch}
    teamA={{ id: "a", name: "Team A" }} teamB={{ id: "b", name: "Team B" }} />)
  mocks.buttons.find(button => button.label === "End Match")!.click()
  return Promise.all(mocks.pending)
}

describe("Dashboard match completion session token", () => {
  it.each([0, 6, undefined])("echoes the epoch rendered by the server (%s)", async epoch => {
    await render(epoch)
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith("match", "a", "Team A won", null, epoch)
    expect(mocks.success).toHaveBeenCalledWith("Match completed")
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it("shows the reload prompt without false completion on a serialized fence failure", async () => {
    mocks.complete.mockResolvedValue({ success: false, code: "SCORING_SESSION_FENCED", message: HANDOVER_RESYNC_COPY })
    await render(5)
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(HANDOVER_RESYNC_COPY)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
