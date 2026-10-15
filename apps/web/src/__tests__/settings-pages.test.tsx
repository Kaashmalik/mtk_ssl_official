import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SettingsPage from "@/app/dashboard/settings/page"
import BillingPage from "@/app/dashboard/settings/billing/page"
import InvoicesPage from "@/app/dashboard/settings/billing/invoices/page"
import InvoiceDetailPage from "@/app/dashboard/settings/billing/[id]/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), settings: vi.fn(), identity: vi.fn(),
  invoices: vi.fn(), invoice: vi.fn(), whiteLabel: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("notFound") },
}))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
vi.mock("@/lib/league-settings-reads", () => ({
  readLeagueSettings: mocks.settings,
  readLeagueIdentity: mocks.identity,
  readInvoices: mocks.invoices,
  readInvoice: mocks.invoice,
  readWhiteLabelRequests: mocks.whiteLabel,
}))
vi.mock("@/components/settings/tenant-settings-form", () => ({ TenantSettingsForm: () => null }))
vi.mock("@/components/settings/white-label-request-panel", () => ({ WhiteLabelRequestPanel: () => null }))
vi.mock("@/components/settings/usage-meters", () => ({ UsageMeters: () => null }))
vi.mock("@/app/dashboard/settings/billing/billing-client", () => ({ BillingPageClient: () => null }))
vi.mock("@/components/billing/subscription-countdown", () => ({ SubscriptionCountdown: () => null }))
vi.mock("@/components/share/print-button", () => ({ PrintButton: () => null }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const INVOICE = "00000000-0000-4000-8000-000000000003"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" }
const identity = { id: TENANT, name: "Premier League", slug: "premier", plan: "pro" }
const invoiceRow = {
  id: INVOICE, invoiceNumber: "SSL-INV-2026-000001", status: "paid", currency: "PKR",
  subtotal: "1000.00", taxRate: "0", taxAmount: "0", total: "1000.00",
  description: null, plan: "pro", periodStart: null, periodEnd: null, paidAt: null, notes: null,
  createdAt: new Date("2026-01-01"),
}

function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as any).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(context)
  mocks.settings.mockResolvedValue({ tenant: identity, branding: { appName: "Premier" } })
  mocks.identity.mockResolvedValue(identity)
  mocks.invoices.mockResolvedValue([{ id: INVOICE, invoiceNumber: "SSL-INV-2026-000001", plan: "pro",
    status: "paid", total: "1000.00", currency: "PKR", paidAt: null, createdAt: new Date("2026-01-01") }])
  mocks.invoice.mockResolvedValue(invoiceRow)
  mocks.whiteLabel.mockResolvedValue([])
})

describe("Settings page requires exact-league authority", () => {
  it("resolves settings:manage and reads only the resolved league", async () => {
    const tree = await SettingsPage()
    expect(mocks.context).toHaveBeenCalledWith("settings:manage")
    expect(mocks.settings).toHaveBeenCalledWith(TENANT)
    expect(mocks.whiteLabel).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("Settings")
  })
  it.each(["Forbidden", "Tenant not found", "Database unavailable"])(
    "propagates %s without a league-setup redirect or fake empty settings", async (message) => {
      mocks.context.mockRejectedValue(new Error(message))
      await expect(SettingsPage()).rejects.toThrow(message)
      expect(mocks.settings).not.toHaveBeenCalled()
      expect(mocks.whiteLabel).not.toHaveBeenCalled()
    })
  it("propagates a read failure instead of rendering empty branding", async () => {
    mocks.settings.mockRejectedValue(new Error("Database unavailable"))
    await expect(SettingsPage()).rejects.toThrow("Database unavailable")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(SettingsPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("Billing page requires exact-league authority", () => {
  it("resolves settings:manage and reads the exact league identity", async () => {
    await BillingPage()
    expect(mocks.context).toHaveBeenCalledWith("settings:manage")
    expect(mocks.identity).toHaveBeenCalledWith(TENANT)
  })
  it("propagates a denied or failed context without a setup redirect", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(BillingPage()).rejects.toThrow("Forbidden")
    expect(mocks.identity).not.toHaveBeenCalled()
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(BillingPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("Invoices page requires exact-league authority", () => {
  it("resolves settings:manage and lists only the resolved league's invoices", async () => {
    const tree = await InvoicesPage()
    expect(mocks.context).toHaveBeenCalledWith("settings:manage")
    expect(mocks.invoices).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("SSL-INV-2026-000001")
  })
  it("propagates a denied or failed context without a setup redirect", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(InvoicesPage()).rejects.toThrow("Forbidden")
    expect(mocks.invoices).not.toHaveBeenCalled()
  })
})

describe("Invoice detail page requires exact-league authority", () => {
  const params = Promise.resolve({ id: INVOICE })
  it("resolves settings:manage and reads the invoice scoped to the resolved league", async () => {
    const tree = await InvoiceDetailPage({ params })
    expect(mocks.context).toHaveBeenCalledWith("settings:manage")
    expect(mocks.invoice).toHaveBeenCalledWith(TENANT, INVOICE)
    expect(mocks.identity).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("Premier League")
  })
  it("404s a foreign or unknown invoice rather than rendering it", async () => {
    mocks.invoice.mockResolvedValue(null)
    await expect(InvoiceDetailPage({ params })).rejects.toThrow("notFound")
  })
  it("propagates a denied context before reading the invoice", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(InvoiceDetailPage({ params })).rejects.toThrow("Forbidden")
    expect(mocks.invoice).not.toHaveBeenCalled()
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(InvoiceDetailPage({ params })).rejects.toThrow("redirect:/sign-in")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
