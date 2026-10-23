import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import RegistrationDetailPage from "@/app/dashboard/registrations/[id]/page"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), detail: vi.fn(), tenant: vi.fn(), user: vi.fn(), teamRows: [] as unknown[], grant: vi.fn() }))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") },
}))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/registration-reads", () => ({ resolveRegistrationReviewAccess: mocks.access, readRegistrationDetail: mocks.detail }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant }))
vi.mock("@mtk/database", () => ({ db: { query: { users: { findFirst: mocks.user } }, select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.teamRows) }) }) }) }, teams: {}, users: {} }))
vi.mock("@mtk/database/lib/resource-grants", () => ({ teamManagementGrant: mocks.grant }))
vi.mock("@mtk/ui/components/ui/badge", () => ({ Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }))
vi.mock("@mtk/ui/components/ui/button", () => ({ Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button> }))
vi.mock("@mtk/ui/components/ui/card", () => {
  const P = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return { Card: P, CardContent: P, CardHeader: P, CardTitle: P }
})
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({ MotionWrapper: ({ children }: { children?: React.ReactNode }) => children }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const detail = { id: "00000000-0000-4000-8000-000000000008", teamId: "00000000-0000-4000-8000-000000000003",
  teamName: "Falcons", tournamentName: "Cup", status: "pending", paymentStatus: "unpaid",
  registrationFee: "150", rejectionReason: null, squadPlayerIds: ["00000000-0000-4000-8000-000000000004"],
  squad: [{ id: "00000000-0000-4000-8000-000000000004", name: "P" }] }

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as { children?: unknown }).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.access.mockResolvedValue({ tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" })
  mocks.detail.mockResolvedValue(detail)
})

describe("Registration detail page authority (ENH-05-03 slice 6)", () => {
  it("renders the truthful entry for the review console cast", async () => {
    const tree = await RegistrationDetailPage({ params: Promise.resolve({ id: detail.id }) })
    const textOut = text(tree)
    expect(textOut).toContain("Falcons")
    expect(textOut).toContain("Not eligible yet")
    expect(textOut).not.toContain("paymentTransaction") // bounded projection end to end
    expect(mocks.tenant).not.toHaveBeenCalled() // reviewer tenant suffices
  })
  it("grants the entry's own team manager through the SAME team pointer allowlist", async () => {
    mocks.access.mockResolvedValue(null)
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.user.mockResolvedValue({ id: "actor", clerkId: "clerk" })
    mocks.teamRows = [{ managerId: "actor", captainId: null }]
    mocks.grant.mockReturnValue("manager")
    await expect(RegistrationDetailPage({ params: Promise.resolve({ id: detail.id }) })).resolves.toBeTruthy()
    expect(redirects.calls).toEqual([])
  })
  it("redirects an unassigned member instead of showing another team's entry", async () => {
    mocks.access.mockResolvedValue(null)
    mocks.tenant.mockResolvedValue(TENANT)
    mocks.user.mockResolvedValue({ id: "actor", clerkId: "clerk" })
    mocks.teamRows = [{ managerId: "someone-else", captainId: null }]
    mocks.grant.mockReturnValue(null)
    await expect(RegistrationDetailPage({ params: Promise.resolve({ id: detail.id }) })).rejects.toThrow("redirect:/dashboard")
  })

  it("the detail route carries a loading skeleton shaped like the page (Batch 114)", async () => {
    const React = (await import("react")).default
    const { renderToStaticMarkup } = await import("react-dom/server")
    const { default: RegistrationDetailLoading } = await import("@/app/dashboard/registrations/[id]/loading")
    const html = renderToStaticMarkup(React.createElement(RegistrationDetailLoading))
    expect(html).toContain("space-y-6")
    expect(html).toContain("animate-shimmer") // a real Skeleton affordance, not an empty shell
  })
})
