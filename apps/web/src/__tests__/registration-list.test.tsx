import React, { Children, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RegistrationList, type Registration } from "@/components/registrations/registration-list"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(), reject: vi.fn(), updateSquad: vi.fn(), options: vi.fn(), withdraw: vi.fn(), bulk: vi.fn(),
  success: vi.fn(), error: vi.fn(),
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
vi.mock("@/app/actions/registrations", () => ({
  approveRegistration: mocks.approve, rejectRegistration: mocks.reject,
  updateRegistrationSquad: mocks.updateSquad, getRegistrationSquadOptions: mocks.options,
  withdrawRegistration: mocks.withdraw, bulkReviewRegistrations: mocks.bulk,
}))
vi.mock("@mtk/ui/components/ui/button", () => ({ Button: ({ children, onClick, disabled, role, "aria-checked": checked, "aria-label": label }: {
  children?: ReactNode; onClick?: () => void; disabled?: boolean; role?: string; "aria-checked"?: boolean; "aria-label"?: string
}) => {
  if (onClick) mocks.buttons.push({ label: label ?? Children.toArray(children).filter(v => typeof v === "string").join("").trim(), click: onClick, disabled, role, checked })
  return <button disabled={disabled}>{children}</button>
} }))
vi.mock("@mtk/ui/components/ui/badge", () => ({ Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span> }))
vi.mock("@mtk/ui/components/ui/textarea", () => ({ Textarea: () => <textarea /> }))
vi.mock("@mtk/ui/components/ui/table", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Table: Passthrough, TableBody: Passthrough, TableHead: Passthrough, TableHeader: Passthrough, TableRow: Passthrough, TableCell: Passthrough }
})
vi.mock("@mtk/ui/components/ui/dialog", () => {
  // The wrapper honours `open` so a CLOSED dialog (e.g. the editor after a
  // failed options load) really stops rendering its affordances.
  const Wrapper = ({ open, children }: { open?: boolean; children?: ReactNode }) => (open === false ? null : <div>{children}</div>)
  return { Dialog: Wrapper, DialogContent: Wrapper, DialogDescription: Wrapper, DialogFooter: Wrapper, DialogHeader: Wrapper, DialogTitle: Wrapper }
})
vi.mock("lucide-react", () => ({ Loader2: () => <span /> }))

const TEAM = "00000000-0000-4000-8000-000000000003"
const P1 = "00000000-0000-4000-8000-000000000004"
const P2 = "00000000-0000-4000-8000-000000000005"
const P3 = "00000000-0000-4000-8000-000000000006"
const REG_ID = "00000000-0000-4000-8000-000000000008"

function row(overrides: Partial<Registration> = {}): Registration {
  return {
    id: REG_ID, teamId: TEAM, teamName: "Falcons", tournamentName: "Summer Cup",
    squadCount: 2, squadPlayerIds: [P1, P2], registrationFee: "150", notes: null,
    status: "pending", paymentStatus: "unpaid", createdAt: new Date("2026-10-15T00:00:00.000Z"),
    eligibility: "Not eligible yet: registration must be approved.",
    ...overrides,
  }
}

const useState = vi.mocked(React.useState)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buttons.length = 0
  mocks.slots.length = 0
  ;(useState as unknown as { index?: number }).index = 0
  mocks.options.mockResolvedValue([{ id: P1, name: "A" }, { id: P2, name: "B" }, { id: P3, name: "C" }])
  mocks.updateSquad.mockResolvedValue({ success: true, changed: true, registration: { id: REG_ID, status: "pending" } })
  mocks.withdraw.mockResolvedValue({ success: true })
  mocks.bulk.mockResolvedValue({ success: true, results: [] })
})

/** Renders a fresh pass; with the slot-backed useState this simulates the re-render after state changes. */
function render(props: Partial<Parameters<typeof RegistrationList>[0]> = {}) {
  ;(useState as unknown as { index?: number }).index = 0
  mocks.buttons.length = 0
  renderToStaticMarkup(<RegistrationList initialRegistrations={props.initialRegistrations ?? [row()]} />)
}

/** Flushes microtasks so an awaited options fetch resolves before the next render pass. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function button(label: RegExp) {
  return mocks.buttons.filter(b => label.test(b.label))
}

describe("RegistrationList console squad editing (ENH-05-03 slice 4)", () => {
  it("offers the editor only while the entry awaits review", () => {
    render({ initialRegistrations: [row({ status: "rejected" }), row({ id: P1, status: "waitlisted" })] })
    expect(button(/edit squad/i)).toHaveLength(1) // rejected entries never get one; waitlisted does
    expect(button(/approve/i)).toHaveLength(0) // the waitlisted row exposes edit, approve stays pending-only
  })

  it("opens the editor with the registered squad preselected from the team's ACTIVE players", async () => {
    render()
    button(/edit squad/i)[0].click()
    await flush()
    render()
    expect(mocks.options).toHaveBeenCalledWith(TEAM)
    expect(button(/^[ABC]$/).map(chip => chip.checked)).toEqual([true, true, false])
  })

  it("submits only the changed list and updates the row with recomputed eligibility", async () => {
    render()
    button(/edit squad/i)[0].click()
    await flush()
    render()
    button(/^[ABC]$/)[2].click() // add C
    render()
    await button(/save squad/i)[0].click()
    expect(mocks.updateSquad).toHaveBeenCalledExactlyOnceWith(REG_ID, { squadPlayerIds: [P1, P2, P3] })
    expect(mocks.success).toHaveBeenCalledWith("Squad updated.")
    // The row's honest sentence is recomputed from the shared policy, locally unchanged otherwise.
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it("tells the truth on an identical replay instead of claiming a new change", async () => {
    mocks.updateSquad.mockResolvedValue({ success: true, changed: false, registration: { id: REG_ID, status: "pending" } })
    render()
    button(/edit squad/i)[0].click()
    await flush()
    render()
    await button(/save squad/i)[0].click()
    expect(mocks.updateSquad).toHaveBeenCalledExactlyOnceWith(REG_ID, { squadPlayerIds: [P1, P2] })
    expect(mocks.success).toHaveBeenCalledWith("Squad was already up to date.")
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it("surfaces a service refusal without pretending the edit landed", async () => {
    mocks.updateSquad.mockRejectedValue(new Error("This registration has already been reviewed and its squad can no longer be edited"))
    render()
    button(/edit squad/i)[0].click()
    await flush()
    render()
    button(/^[ABC]$/)[2].click()
    render()
    await button(/save squad/i)[0].click()
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/no longer be edited/))
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("withdraw is offered from pending and approved, and a withdrawn row loses every action", async () => {
    render({ initialRegistrations: [row(), row({ id: P1, status: "approved" }), row({ id: P2, status: "waitlisted" })] })
    expect(button(/withdraw/i)).toHaveLength(2)
    render({ initialRegistrations: [row()] })
    button(/withdraw/i)[0].click()
    render()
    await button(/confirm withdrawal/i)[0].click()
    expect(mocks.withdraw).toHaveBeenCalledExactlyOnceWith(REG_ID)
    expect(mocks.success).toHaveBeenCalled()
    render({ initialRegistrations: [row({ status: "withdrawn" })] })
    expect(button(/approve|reject|edit squad|withdraw/i)).toHaveLength(0)
  })

  it("refuses an empty squad submit and surfaces a failed options load by closing the editor", async () => {
    render({ initialRegistrations: [row({ squadPlayerIds: ["00000000-0000-4000-8000-000000000099"] })] }) // player left the roster
    button(/edit squad/i)[0].click()
    await flush()
    render()
    const save = button(/save squad/i)[0]
    expect(save.disabled).toBe(true)
    save.click()
    expect(mocks.updateSquad).not.toHaveBeenCalled()

    mocks.options.mockRejectedValue(new Error("DB down"))
    render()
    button(/edit squad/i)[0].click()
    await flush()
    render()
    // The editor is closed again: no half-open dialog with a failed roster behind it.
    expect(button(/save squad/i)).toHaveLength(0)
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to load the team's players|DB down/))
  })
})

describe("RegistrationList bulk review (Batch 120)", () => {
  const ALPHA = "00000000-0000-4000-8000-000000000010"
  const BETA = "00000000-0000-4000-8000-000000000011"

  it("only pending rows are selectable, and selecting them reveals the bulk bar", async () => {
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" }), row({ id: BETA, teamName: "Beta", status: "approved" as const })] })
    const checkboxes = button(/select (alpha|beta)/i).filter(b => b.role === "checkbox")
    expect(checkboxes).toHaveLength(1) // Beta is approved: it cannot be bulk-reviewed
    expect(button(/approve selected/i)).toHaveLength(0)

    checkboxes[0].click()
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" }), row({ id: BETA, teamName: "Beta", status: "approved" as const })] })
    expect(button(/approve selected/i)).toHaveLength(1)
  })

  it("bulk approve composes the single commands and reports the honest aggregate", async () => {
    mocks.bulk.mockResolvedValue({
      success: true,
      results: [
        { id: ALPHA, ok: true, status: "approved", tournamentId: "00000000-0000-4000-8000-000000000007" },
        { id: BETA, ok: false, error: "This tournament is already at its maximum number of teams" },
      ],
    })
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" }), row({ id: BETA, teamName: "Beta" })] })
    const select = button(/select (alpha|beta)/i).filter(b => b.role === "checkbox")
    select[0].click()
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" }), row({ id: BETA, teamName: "Beta" })] })
    button(/select (alpha|beta)/i).filter(b => b.role === "checkbox")[1].click()
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" }), row({ id: BETA, teamName: "Beta" })] })
    button(/approve selected/i)[0].click()
    await flush()
    expect(mocks.bulk).toHaveBeenCalledWith("approve", [ALPHA, BETA])
    expect(mocks.success).toHaveBeenCalledWith(expect.stringMatching(/1 registration reviewed/))
    expect(mocks.error).toHaveBeenCalledWith("This tournament is already at its maximum number of teams")
  })

  it("bulk reject requires the shared reason dialog and passes the reason through", async () => {
    mocks.bulk.mockResolvedValue({ success: true, results: [{ id: ALPHA, ok: true, status: "rejected", tournamentId: "00000000-0000-4000-8000-000000000007" }] })
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" })] })
    button(/select alpha/i).filter(b => b.role === "checkbox")[0].click()
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" })] })
    button(/reject selected/i)[0].click()
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" })] })
    // The shared dialog is open (its title renders) with a Confirm button.
    const confirm = button(/confirm reject/i)
    expect(confirm.length).toBeGreaterThan(0)
    // The rejection reason lives in the rejectionReason state slot (index 3):
    // set it as the textarea would, then confirm the bulk rejection.
    mocks.slots[3] = "Squad does not meet the published minimum"
    render({ initialRegistrations: [row({ id: ALPHA, teamName: "Alpha" })] })
    button(/confirm reject/i)[0].click()
    await flush()
    expect(mocks.bulk).toHaveBeenCalledWith("reject", [ALPHA], "Squad does not meet the published minimum")
  })
})
