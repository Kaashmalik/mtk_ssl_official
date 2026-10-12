import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { UserListTable } from "@/components/users/user-list-table"
import { readFileSync } from "node:fs"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/actions/users", () => ({ updateUserRole: vi.fn(), toggleUserStatus: vi.fn() }))
vi.mock("@mtk/ui/components/ui/select", () => ({
  Select: ({ children, value, disabled }: any) => <div data-value={value} data-disabled={disabled}>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: () => null, SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <span data-option={value}>{children}</span>,
}))
vi.mock("@mtk/ui/components/ui/dialog", () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null,
  DialogTitle: () => null, DialogDescription: () => null, DialogFooter: () => null,
}))
const member = { id: "ali", membershipId: "membership-A", email: "ali@example.test", displayName: "Ali", avatarUrl: null,
  role: "scorer", status: "active" as const, accountActive: true, protectedAccess: false, version: 2, createdAt: new Date("2026-10-12T00:00:00Z") }
const render = (input = member) => renderToStaticMarkup(<UserListTable initialUsers={[input]} currentUserId="owner" tenantId="A" tenantName="League A" />)
describe("League member UI contracts (SSR/stubbed controls, not browser certification)", () => {
  it("labels league-only effects and loaded-row search", () => {
    const html = render()
    expect(html).toContain("Active in league")
    expect(html).toContain("Suspend in league")
    expect(html).toContain('aria-label="Search loaded league members"')
    expect(html).toContain("100 members")
    expect(html).toContain("Search applies to loaded members only")
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("overflow-x-auto")
  })
  it("separates active membership from globally blocked account", () => {
    const html = render({ ...member, accountActive: false })
    expect(html).toContain("Active in league")
    expect(html).toContain("Platform account blocked")
  })
  it("shows a suspended membership without calling it global disablement", () => {
    const html = render({ ...member, status: "suspended" } as typeof member)
    expect(html).toContain("Suspended in league")
    expect(html).toContain("Reactivate in league")
    expect(html).not.toContain("Disable")
  })
  it.each([{ id: "owner" }, { role: "league_owner" }, { role: "super_admin" }, { protectedAccess: true }])("does not offer ordinary controls for protected member %s", change => {
    const html = render({ ...member, ...change })
    expect(html).not.toContain("Suspend in league")
    expect(html).not.toContain("data-option")
  })
  it("does not offer owner or platform grants in the role selector", () => {
    const html = render()
    expect(html).not.toContain('data-option="league_owner"')
    expect(html).not.toContain('data-option="super_admin"')
    expect(html).toContain('data-value="scorer"')
    expect(html).toContain('aria-label="League role for Ali"')
  })
  it("escapes member names/emails in rendered content", () => {
    const html = render({ ...member, displayName: "<script>bad</script>" })
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;")
    expect(html).not.toContain("<script>")
  })
  it("keeps controls server-confirmed with workspace/version keys and suspension confirmation", () => {
    const source = readFileSync(new URL("../components/users/user-list-table.tsx", import.meta.url), "utf8")
    expect(source).toContain("value={member.role}")
    expect(source).not.toContain("defaultValue={member.role}")
    expect(source).toContain("expectedVersion: member.version")
    expect(source).toContain("membershipId: member.membershipId")
    expect(source).toContain("result.member")
    expect(source).toContain("Confirm league change")
    expect(source).toContain("No other league or global account is changed")
  })
})
