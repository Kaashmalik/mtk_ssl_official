import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DashboardLayout from "@/app/dashboard/layout"
import { TrialBannerServer } from "@/components/billing/trial-banner-server"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), subscription: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("@/app/dashboard/dashboard-shell", () => ({ DashboardShell: () => null }))
vi.mock("@/lib/subscription-status", () => ({ getSubscriptionStatus: mocks.subscription }))
vi.mock("@/components/billing/trial-banner", () => ({ TrialBanner: () => null }))
const context = { tenantId: "host-tenant", tenantName: "League", actorId: "actor", role: "league_owner" as const }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue({ status: "ready", context })
  mocks.subscription.mockResolvedValue({ status: "trialing", daysRemaining: 4, plan: "pro" })
})

describe("Active-tenant dashboard shell and billing notice", () => {
  it("uses the authorized context for navigation and billing", async () => {
    const shell = await DashboardLayout({ children: <p>Page</p> })
    expect(shell.props.userRole).toBe("league_owner")
    expect(shell.props.banner.props.context).toBe(context)
    expect(mocks.context).toHaveBeenCalledWith("clerk")
  })
  it.each(["scorer", "coach", "team_manager", "player", "fan"] as const)("hides billing from %s without downgrading its own role", async (role) => {
    mocks.context.mockResolvedValue({ status: "ready", context: { ...context, role } })
    const shell = await DashboardLayout({ children: null })
    expect(shell.props.userRole).toBe(role)
    expect(shell.props.banner).toBeNull()
  })
  it.each(["no-tenant", "denied", "unavailable"])("does not elevate global roles or show billing on %s", async (status) => {
    mocks.context.mockResolvedValue({ status })
    const shell = await DashboardLayout({ children: null })
    expect(shell.props.userRole).toBe("fan")
    expect(shell.props.banner).toBeNull()
  })
  it("does not resolve a tenant for anonymous shell rendering", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect((await DashboardLayout({ children: null })).props.banner).toBeNull()
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it("remains minimal after an unexpected access lookup error", async () => {
    mocks.context.mockRejectedValue(new Error("unavailable"))
    const shell = await DashboardLayout({ children: null })
    expect(shell.props.userRole).toBe("fan")
    expect(shell.props.banner).toBeNull()
  })
  it("reads only the active tenant's subscription for authorized managers", async () => {
    const banner = await TrialBannerServer({ context })
    expect(mocks.subscription).toHaveBeenCalledWith("host-tenant")
    expect(banner!.props).toEqual({ daysRemaining: 4, plan: "pro" })
  })
  it.each(["scorer", "fan", "team_manager"] as const)("never reads subscription details for %s", async (role) => {
    expect(await TrialBannerServer({ context: { ...context, role } })).toBeNull()
    expect(mocks.subscription).not.toHaveBeenCalled()
  })
  it.each([{ status: "active", daysRemaining: 4 }, { status: "trialing", daysRemaining: 0 },
    { status: "trialing", daysRemaining: null }])("does not invent an active trial from %s", async (subscription) => {
    mocks.subscription.mockResolvedValue({ ...subscription, plan: "pro" })
    expect(await TrialBannerServer({ context })).toBeNull()
  })
  it("does not break the dashboard after a billing outage", async () => {
    mocks.subscription.mockRejectedValue(new Error("unavailable"))
    expect(await TrialBannerServer({ context })).toBeNull()
  })
})
