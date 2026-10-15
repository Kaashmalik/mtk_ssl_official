import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LeagueSetupPage from "@/app/dashboard/league/setup/page"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), owned: vi.fn(), form: vi.fn() }))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
}))
vi.mock("@/app/actions/tenants", () => ({ getMyOwnedTenant: mocks.owned }))
vi.mock("@/components/league-setup-form", () => ({ LeagueSetupForm: mocks.form }))
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({
  MotionWrapper: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children),
}))

/** Collects rendered text from the returned tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out }
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode }
  React.Children.forEach(props.children, (child) => collectText(child, out))
  return out
}

/** True when the returned tree contains an element of the given component type (no real render). */
function containsElementType(node: unknown, type: unknown): boolean {
  if (!React.isValidElement(node)) return false
  if (node.type === type) return true
  const props = node.props as { children?: React.ReactNode }
  let found = false
  React.Children.forEach(props.children, (child) => {
    if (containsElementType(child, type)) found = true
  })
  return found
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk-1" })
  mocks.owned.mockResolvedValue(null)
})

describe("League setup bounces owners, not league members", () => {
  it("offers the create form to an account that is only a member of another league", async () => {
    const tree = await LeagueSetupPage()
    expect(mocks.owned).toHaveBeenCalledTimes(1)
    expect(containsElementType(tree, mocks.form)).toBe(true)
    expect(collectText(tree)).toContain("Create your league")
    expect(redirects.calls).toEqual([])
  })

  it("sends an existing owner to the dashboard without rendering the form", async () => {
    mocks.owned.mockResolvedValue({ id: "t1", name: "Mine", slug: "mine" })
    await expect(LeagueSetupPage()).rejects.toThrow("redirect:/dashboard")
    expect(redirects.calls).toEqual(["/dashboard"])
  })

  it("sends unauthenticated visitors to the home page before any read", async () => {
    mocks.auth.mockResolvedValue({})
    await expect(LeagueSetupPage()).rejects.toThrow("redirect:/")
    expect(mocks.owned).not.toHaveBeenCalled()
  })

  it("propagates an ownership lookup failure instead of showing or bouncing", async () => {
    mocks.owned.mockRejectedValue(new Error("Database unavailable"))
    await expect(LeagueSetupPage()).rejects.toThrow("Database unavailable")
    expect(redirects.calls).toEqual([])
  })
})
