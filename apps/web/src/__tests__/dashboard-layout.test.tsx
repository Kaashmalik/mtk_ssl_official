import React, { type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DashboardLayout from "@/app/dashboard/layout"
import { TrialBannerServer } from "@/components/billing/trial-banner-server"
// Element-tree probe: the layout embeds this exact component identity next to
// the recovery notice; inspection never renders it, so no hook mocks needed.
import { PlatformContact as DashboardLayoutContactProbe } from "@/components/support/platform-contact"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), subscription: vi.fn(), reconcile: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("@/lib/account-provisioning", () => ({ reconcileSessionUser: mocks.reconcile }))
vi.mock("@/app/dashboard/dashboard-shell", () => ({ DashboardShell: () => null }))
vi.mock("@/lib/subscription-status", () => ({ getSubscriptionStatus: mocks.subscription }))
vi.mock("@/components/billing/trial-banner", () => ({ TrialBanner: () => null }))
const context = { tenantId: "host-tenant", tenantName: "League", actorId: "actor", role: "league_owner" as const }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue({ status: "ready", context })
  mocks.reconcile.mockResolvedValue(true)
  mocks.subscription.mockResolvedValue({ status: "trialing", daysRemaining: 4, plan: "pro" })
})

describe("Active-tenant dashboard shell and billing notice", () => {
  it.each(["denied", "unavailable", "provisioning"])("does not render private children on %s (pages still need their own authorization)", async status => {
    mocks.context.mockResolvedValue({ status })
    const privateChild = <p>Private league records</p>
    const shell = await DashboardLayout({ children: privateChild })
    expect(shell.props.children).not.toBe(privateChild)
    const alert = React.Children.toArray(shell.props.children.props.children).find(
      (child: any) => child?.props?.role === "alert",
    )
    expect(alert).toBeTruthy()
  })
  it("keeps the authenticated no-league onboarding child available", async () => {
    mocks.context.mockResolvedValue({ status: "no-tenant" })
    const setup = <p>Setup</p>
    expect((await DashboardLayout({ children: setup })).props.children).toBe(setup)
  })

  it("shows a truthful provisioning notice on a delayed webhook — not the access-denied lie (ENH-02-01)", async () => {
    mocks.context.mockResolvedValue({ status: "provisioning" })
    const shell = await DashboardLayout({ children: <p>Setup</p> })
    const notice = JSON.stringify(shell.props.children)
    expect(notice).not.toContain("Contact the organizer")
    expect(notice).not.toContain("Setup") // children withheld while unprovisioned
  })

  it("attaches the privacy-conscious support contact to the recovery notice (ENH-02-04)", async () => {
    mocks.context.mockResolvedValue({ status: "provisioning" })
    const shell = await DashboardLayout({ children: <p>Setup</p> })
    const found: React.ReactElement[] = []
    const walk = (node: unknown): void => {
      if (!React.isValidElement(node)) return
      const element = node as React.ReactElement<{ children?: ReactNode }>
      found.push(element)
      React.Children.forEach(element.props?.children, walk)
    }
    walk(shell.props.children as never)
    const contact = found.find((element) => element.type === DashboardLayoutContactProbe)
    expect(contact, "the support contact should ride with the recovery notice").toBeTruthy()
    expect((contact!.props as { context: { topic: string } }).context).toEqual({ topic: "recovery" })
  })

  it("recovers a delayed webhook exactly once: reconcile, then re-resolve before giving up (ENH-02-01)", async () => {
    mocks.context
      .mockResolvedValueOnce({ status: "provisioning" })
      .mockResolvedValueOnce({ status: "no-tenant" })
    const setup = <p>Setup</p>
    const shell = await DashboardLayout({ children: setup })
    expect(mocks.reconcile).toHaveBeenCalledTimes(1)
    expect(mocks.context).toHaveBeenCalledTimes(2)
    expect(shell.props.children).toBe(setup)
  })

  it("stays on the truthful provisioning notice when reconciliation cannot recover (ENH-02-01)", async () => {
    mocks.context.mockResolvedValue({ status: "provisioning" })
    mocks.reconcile.mockResolvedValue(false)
    const shell = await DashboardLayout({ children: <p>Setup</p> })
    const notice = JSON.stringify(shell.props.children)
    expect(notice).not.toContain("Setup")
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })
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
  it.each(["no-tenant", "denied", "unavailable", "provisioning"])("does not elevate global roles or show billing on %s", async (status) => {
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
