import React, { Children, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TeamRegistrations, type TeamRegistrationEntry } from "@/components/registrations/team-registrations"

const mocks = vi.hoisted(() => ({
  updateSquad: vi.fn(), success: vi.fn(), error: vi.fn(),
  buttons: [] as Array<{ label: string; click: () => void; disabled?: boolean; role?: string; checked?: boolean }>,
  // useState over persistent slots: re-rendering re-executes the component so
  // freshly captured handlers close over the CURRENT state, exactly as a real
  // React render cycle would.
  slots: [] as unknown[],
}))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (init: unknown) => {
  const index = (useState as unknown as { index?: number }).index ?? 0
  ;(useState as unknown as { index?: number }).index = index + 1
  const value = mocks.slots[index] === undefined ? init : mocks.slots[index]
  const set = (next: unknown) => {
    mocks.slots[index] = typeof next === "function" ? (next as (prev: unknown) => unknown)(value) : next
  }
  return [value, set]
} }))
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock("@/app/actions/registrations", () => ({ updateRegistrationSquad: mocks.updateSquad }))
vi.mock("@mtk/ui/components/ui/button", () => ({ Button: ({ children, onClick, disabled, role, "aria-checked": checked, "aria-label": label }: {
  children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string; "aria-checked"?: boolean; "aria-label"?: string
}) => {
  if (onClick) mocks.buttons.push({ label: label ?? Children.toArray(children).filter(v => typeof v === "string").join("").trim(), click: onClick, disabled, role, checked })
  return <button disabled={disabled}>{children}</button>
} }))
vi.mock("@mtk/ui/components/ui/badge", () => ({ Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span> }))
vi.mock("@mtk/ui/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Dialog: Wrapper, DialogContent: Wrapper, DialogDescription: Wrapper, DialogFooter: Wrapper, DialogHeader: Wrapper, DialogTitle: Wrapper }
})

const P1 = "00000000-0000-4000-8000-000000000004"
const P2 = "00000000-0000-4000-8000-000000000005"
const P3 = "00000000-0000-4000-8000-000000000006"
const REG = "00000000-0000-4000-8000-000000000008"
const ROSTER = [{ id: P1, name: "A" }, { id: P2, name: "B" }, { id: P3, name: "C" }]

function entry(overrides: Partial<TeamRegistrationEntry> = {}): TeamRegistrationEntry {
  return {
    id: REG, tournamentName: "Cup", status: "pending", paymentStatus: "unpaid",
    squadPlayerIds: [P1], eligibility: "Not eligible yet: registration must be approved.",
    ...overrides,
  }
}

const useState = vi.mocked(React.useState)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buttons.length = 0
  mocks.slots.length = 0
  mocks.updateSquad.mockResolvedValue({ success: true, changed: true, registration: { id: REG, status: "pending" } })
  vi.stubGlobal("React", React)
})
afterEach(() => {
  vi.unstubAllGlobals()
  ;(useState as unknown as { index?: number }).index = 0
})

/** Renders a fresh pass; with the slot-backed useState this simulates the re-render after state changes. */
function render(props: Partial<Parameters<typeof TeamRegistrations>[0]> = {}) {
  ;(useState as unknown as { index?: number }).index = 0
  mocks.buttons.length = 0
  const registrations = props.registrations ?? [entry()]
  renderToStaticMarkup(<TeamRegistrations
    registrations={registrations}
    roster={props.roster ?? ROSTER}
    canManage={props.canManage ?? true} />)
}

function button(label: RegExp) {
  return mocks.buttons.filter(b => label.test(b.label))
}

describe("TeamRegistrations (ENH-05-03 slice 2)", () => {
  it("shows the truthful eligibility sentence and never offers a squad edit to a read-only visitor", () => {
    ;(useState as unknown as { index?: number }).index = 0
    mocks.slots.length = 0
    const html = renderToStaticMarkup(<TeamRegistrations registrations={[entry()]} roster={ROSTER} canManage={false} />)
    expect(html).toContain("registration must be approved")
    render({ canManage: false })
    expect(button(/edit squad/i)).toHaveLength(0)
  })
  it("keeps the honest not-configured blocker visible even before any review", () => {
    const html = renderToStaticMarkup(<TeamRegistrations
      registrations={[entry({ eligibility: "Not eligible yet: tournament minimum squad size is not configured." })]}
      roster={ROSTER} canManage />)
    expect(html).toContain("tournament minimum squad size is not configured")
  })

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(<TeamRegistrations registrations={[]} roster={ROSTER} canManage />)
    expect(html).toContain("No tournament registrations")
  })

  it("offers the squad edit only while the entry awaits review", () => {
    render({ registrations: [entry({ id: REG, status: "pending" }), entry({ id: P2, status: "approved" }), entry({ id: P3, status: "waitlisted" })] })
    expect(button(/edit squad/i)).toHaveLength(2)
  })

  it("an assigned manager edits the squad: preselection, changed list, audited update, honest replay toast", async () => {
    render({ registrations: [entry({ squadPlayerIds: [P1, P2] })] })
    button(/edit squad/i)[0].click() // opens the editor, preselects the registered A+B
    render() // re-render cycle: chips now reflect the preselection
    const chips = button(/^[ABC]$/)
    expect(chips.map(chip => chip.checked)).toEqual([true, true, false])
    chips[2].click() // add C
    render() // re-render: Save closes over the changed selection
    await button(/save squad/i)[0].click()
    expect(mocks.updateSquad).toHaveBeenCalledExactlyOnceWith(REG, { squadPlayerIds: [P1, P2, P3] })
    expect(mocks.success).toHaveBeenCalledWith("Squad updated.")
  })

  it("tells the truth on an identical replay instead of claiming a new change", async () => {
    mocks.updateSquad.mockResolvedValue({ success: true, changed: false, registration: { id: REG, status: "pending" } })
    render()
    button(/edit squad/i)[0].click()
    render()
    await button(/save squad/i)[0].click()
    expect(mocks.updateSquad).toHaveBeenCalledExactlyOnceWith(REG, { squadPlayerIds: [P1] })
    expect(mocks.success).toHaveBeenCalledWith("Squad was already up to date.")
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it("surfaces a service refusal without pretending the edit landed", async () => {
    mocks.updateSquad.mockRejectedValue(new Error("This registration has already been reviewed and its squad can no longer be edited"))
    render()
    button(/edit squad/i)[0].click()
    render()
    await button(/save squad/i)[0].click()
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/no longer be edited/))
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("refuses an empty squad submit and shows when no roster players exist", () => {
    render({ registrations: [entry({ squadPlayerIds: ["00000000-0000-4000-8000-000000000099"] })] }) // registered id left the roster
    button(/edit squad/i)[0].click()
    render()
    const save = button(/save squad/i)[0]
    expect(save.disabled).toBe(true)
    save.click()
    expect(mocks.updateSquad).not.toHaveBeenCalled()
  })
})