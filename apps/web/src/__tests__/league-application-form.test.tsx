import React, { type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { LeagueApplicationForm } from "@/components/league-application-form"

/**
 * ENH-02-02 — applicant console state repairs, stubbed (no browser):
 *   1. "Start a new application" after a TERMINAL decision must reset the
 *      application identity/version, or the next save sends the dead
 *      application's version and the server refuses it as stale;
 *   2. the saved status and reviewer request must be re-readable on demand
 *      (refresh), because the server side keeps moving under a quiet tab;
 *   3. replies under an information request are persisted surfaces.
 */

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  getMine: vi.fn(),
  reply: vi.fn(),
  cursor: 0,
  states: [] as unknown[],
  touched: [] as boolean[],
  setters: [] as Array<(update: unknown) => void>,
  pending: [] as Array<Promise<void>>,
  buttons: [] as Array<{ label: string; disabled?: boolean; click?: () => void }>,
  inputs: [] as Array<{ id?: string; value: string; onChange: (event: { target: { value: string } }) => void }>,
  textareas: [] as Array<{ value: string; onChange: (event: { target: { value: string } }) => void }>,
}))

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = mocks.cursor++
    // Seed the slot with the true initial so functional updaters (e.g.
    // setReplies(thread => [...thread, reply])) see the real previous value.
    if (mocks.touched[index] !== true) {
      mocks.states[index] = typeof initial === "function" ? initial() : initial
    }
    return [mocks.states[index], mocks.setters[index]]
  },
  useTransition: () => [
    false,
    (callback: () => Promise<void>) => {
      mocks.pending.push(callback().catch(() => undefined))
    },
  ],
}))
vi.mock("@/app/actions/league-applications", () => ({
  saveLeagueApplication: mocks.save,
  submitLeagueApplication: mocks.submit,
  withdrawLeagueApplication: mocks.withdraw,
  getMyLeagueApplication: mocks.getMine,
  replyLeagueApplication: mocks.reply,
}))
vi.mock("@mtk/ui/components/ui/badge", () => ({ Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span> }))
vi.mock("@mtk/ui/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => {
    const label = React.Children.toArray(children).filter((child) => typeof child === "string").join("").trim()
    mocks.buttons.push({ label, disabled, click: onClick })
    return <button disabled={disabled}>{children}</button>
  },
}))
vi.mock("@mtk/ui/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@mtk/ui/components/ui/input", () => ({
  Input: ({ id, value, onChange }: { id?: string; value: string; onChange: (event: { target: { value: string } }) => void }) => {
    mocks.inputs.push({ id, value, onChange })
    return <input id={id} value={value} readOnly />
  },
}))
vi.mock("@mtk/ui/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}))
vi.mock("@mtk/ui/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <option>{children}</option>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@mtk/ui/components/ui/textarea", () => ({
  Textarea: ({ value, onChange }: { value: string; onChange?: (event: { target: { value: string } }) => void }) => {
    mocks.textareas.push({ value, onChange: onChange ?? (() => undefined) })
    return <textarea value={value} readOnly />
  },
}))
vi.mock("next/link", () => ({ default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock("lucide-react", () => ({
  ClipboardCheck: () => null,
  Copy: () => null,
  ExternalLink: () => null,
  FileText: () => null,
  MessageCircle: () => null,
  MessagesSquare: () => null,
  RefreshCw: () => null,
  ShieldCheck: () => null,
}))

const APP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const BASE_APPLICATION = {
  id: APP_ID,
  state: "draft" as const,
  proposedName: "My League",
  proposedSlug: "my-league",
  desiredPlan: "free" as const,
  version: 0,
  reviewReason: null,
  submittedAt: null,
  reviewedAt: null,
  createdAt: "2026-10-17T08:00:00.000Z",
  updatedAt: "2026-10-17T08:00:00.000Z",
}

function flush() {
  return Promise.all(mocks.pending.splice(0))
}

function render(props: Parameters<typeof LeagueApplicationForm>[0]) {
  // Every render is a FRESH mount over the persisted hook state: reset the
  // hook cursor and re-collect the element handles.
  mocks.cursor = 0
  mocks.buttons = []
  mocks.inputs = []
  mocks.textareas = []
  const html = renderToStaticMarkup(<LeagueApplicationForm {...props} />)
  return html
}

function button(label: string) {
  const found = mocks.buttons.find((candidate) => candidate.label === label)
  expect(found, `button "${label}" should be on screen`).toBeTruthy()
  return found!
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cursor = 0
  mocks.states = []
  mocks.touched = []
  mocks.pending = []
  mocks.buttons = []
  mocks.inputs = []
  mocks.textareas = []
  mocks.setters = Array.from({ length: 12 }, (_, index) => (update: unknown) => {
    mocks.touched[index] = true
    mocks.states[index] = typeof update === "function" ? (update as (previous: unknown) => unknown)(mocks.states[index]) : update
  })
})

describe("applicant console state (ENH-02-02)", () => {
  it("starts a fresh application after a terminal decision: identity and version reset (no stale refusal)", async () => {
    const decided = { ...BASE_APPLICATION, state: "withdrawn" as const, version: 5 }
    render({ initialApplication: decided, initialReplies: [] })

    button("Start a new application").click!()

    render({ initialApplication: decided, initialReplies: [] })
    mocks.inputs.find((input) => input.id === "application-name")!.onChange({ target: { value: "New League" } })

    render({ initialApplication: decided, initialReplies: [] })
    button("Save draft").click!()
    await flush()

    // The terminal application's version (5) must never be sent: this is a
    // CREATE, not an edit of the dead row.
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "New League", expectedVersion: null }))
  })

  it("re-reads the saved status and reviewer request on demand (refresh)", async () => {
    render({
      initialApplication: { ...BASE_APPLICATION, state: "submitted", version: 1 },
      initialReplies: [],
    })
    const refreshed = {
      application: {
        ...BASE_APPLICATION,
        state: "needs_information" as const,
        version: 2,
        reviewReason: "Add the club list",
      },
      replies: [
        { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3401", applicationId: APP_ID, authorSide: "applicant", body: "Club list attached", createdAt: "2026-10-18T09:00:00.000Z" },
      ],
    }
    mocks.getMine.mockResolvedValue(refreshed)

    button("Refresh status").click!()
    await flush()

    expect(mocks.getMine).toHaveBeenCalledTimes(1)
    const html = render({ initialApplication: { ...BASE_APPLICATION, state: "submitted", version: 1 }, initialReplies: [] })
    // The reviewer's request is visible again, together with the persisted thread.
    expect(html).toContain("Add the club list")
    expect(html).toContain("Club list attached")
    expect(html).toContain("Answer the platform")
  })

  it("posts a persisted reply while the platform has requested information", async () => {
    render({ initialApplication: { ...BASE_APPLICATION, state: "needs_information", version: 2, reviewReason: "Add the club list" }, initialReplies: [] })
    mocks.reply.mockResolvedValue({
      reply: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3401", applicationId: APP_ID, authorSide: "applicant", body: "Sent the club list.", createdAt: "2026-10-18T09:00:00.000Z" },
    })

    mocks.textareas[0].onChange({ target: { value: "Sent the club list." } })
    render({ initialApplication: { ...BASE_APPLICATION, state: "needs_information", version: 2, reviewReason: "Add the club list" }, initialReplies: [] })
    button("Post reply").click!()
    await flush()

    expect(mocks.reply).toHaveBeenCalledWith({ applicationId: APP_ID, body: "Sent the club list." })
    const html = render({ initialApplication: { ...BASE_APPLICATION, state: "needs_information", version: 2, reviewReason: "Add the club list" }, initialReplies: [] })
    expect(html).toContain("Sent the club list.")
  })

  it("keeps a submitted application read-only on the client too (guard)", () => {
    const html = render({ initialApplication: { ...BASE_APPLICATION, state: "submitted", version: 1 }, initialReplies: [] })

    expect(mocks.inputs).toHaveLength(0)
    expect(html).not.toContain("Save draft")
    // ENH-02-04: the support contact travels with the status surface.
    expect(html).toContain("+92 303 8111297")
    expect(html).toContain("https://wa.me/923038111297")
    expect(mocks.buttons.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["Withdraw application", "Refresh status", "Show message preview", "Copy number"]),
    )
    expect(mocks.buttons.map((entry) => entry.label)).not.toContain("Start a new application")
  })
})
