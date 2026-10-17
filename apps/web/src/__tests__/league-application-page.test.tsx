import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LeagueApplicationPage from "@/app/dashboard/league/apply/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  owned: vi.fn(),
  application: vi.fn(),
  form: vi.fn(),
}))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    redirects.calls.push(href)
    throw new Error(`redirect:${href}`)
  },
}))
vi.mock("@/app/actions/tenants", () => ({ getMyOwnedTenant: mocks.owned }))
vi.mock("@/app/actions/league-applications", () => ({ getMyLeagueApplication: mocks.application }))
vi.mock("@/components/league-application-form", () => ({ LeagueApplicationForm: mocks.form }))
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({
  MotionWrapper: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
}))

/** Collects rendered text from the returned tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node))
    return out
  }
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode }
  React.Children.forEach(props.children, (child) => collectText(child, out))
  return out
}

/** Finds the first element of the given component type (no real render). */
function findElement(node: unknown, type: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null
  if (node.type === type) return node
  const props = node.props as { children?: React.ReactNode }
  let found: React.ReactElement | null = null
  React.Children.forEach(props.children, (child) => {
    if (!found) found = findElement(child, type)
  })
  return found
}

const APPLICATION = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
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

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk-1" })
  mocks.owned.mockResolvedValue(null)
  mocks.application.mockResolvedValue({ application: null })
})

describe("League application page", () => {
  it("renders the application form with the account's latest application", async () => {
    mocks.application.mockResolvedValue({ application: APPLICATION })

    const tree = await LeagueApplicationPage()

    expect(mocks.owned).toHaveBeenCalledTimes(1)
    expect(mocks.application).toHaveBeenCalledTimes(1)
    const form = findElement(tree, mocks.form)
    expect((form?.props as { initialApplication?: unknown })?.initialApplication).toEqual(APPLICATION)
    expect(collectText(tree)).toEqual(expect.arrayContaining(["Apply for a league"]))
    expect(redirects.calls).toEqual([])
  })

  it("renders a first-time applicant a null application", async () => {
    const tree = await LeagueApplicationPage()

    const form = findElement(tree, mocks.form)
    expect((form?.props as { initialApplication?: unknown })?.initialApplication).toBeNull()
  })

  it("sends an existing owner to the dashboard without loading the application", async () => {
    mocks.owned.mockResolvedValue({ id: "t1", name: "Mine", slug: "mine" })

    await expect(LeagueApplicationPage()).rejects.toThrow("redirect:/dashboard")
    expect(redirects.calls).toEqual(["/dashboard"])
    expect(mocks.application).not.toHaveBeenCalled()
  })

  it("sends unauthenticated visitors home before any read", async () => {
    mocks.auth.mockResolvedValue({})

    await expect(LeagueApplicationPage()).rejects.toThrow("redirect:/")
    expect(mocks.owned).not.toHaveBeenCalled()
    expect(mocks.application).not.toHaveBeenCalled()
  })

  it("propagates an ownership lookup failure instead of showing or bouncing", async () => {
    mocks.owned.mockRejectedValue(new Error("Database unavailable"))

    await expect(LeagueApplicationPage()).rejects.toThrow("Database unavailable")
    expect(redirects.calls).toEqual([])
  })
})
