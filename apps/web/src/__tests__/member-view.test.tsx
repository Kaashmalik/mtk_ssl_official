import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { UserListTable } from "@/components/users/user-list-table"
import { readFileSync } from "node:fs"
import type { MemberAssignmentMap } from "@/lib/member-assignments"

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
const render = (input: React.ComponentProps<typeof UserListTable>["initialUsers"][number] = member, assignments?: MemberAssignmentMap) =>
  renderToStaticMarkup(<UserListTable initialUsers={[input]} assignments={assignments} currentUserId="owner" tenantId="A" tenantName="League A" />)
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
    const html = render({ ...member, status: "suspended" })
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
  it("surfaces the operational assignments that block a removal", () => {
    const html = render(member, { [member.id]: { managedTeams: [{ id: "team-1", name: "Falcons" }, { id: "team-2", name: "Hawks" }], isComplete: true, scoringMatches: [
      { id: "m1", matchNumber: 7, status: "live", scheduledDate: null, role: "scorer" },
      { id: "m2", matchNumber: 8, status: "scheduled", scheduledDate: null, role: "backup" },
    ] } })
    expect(html).toContain("Assignments")
    expect(html).toContain("manages 2 teams")
    expect(html).toContain('href="/dashboard/teams/team-1"')
    expect(html).toContain('href="/dashboard/matches/m1"')
    expect(html).toContain('href="/dashboard/matches/m2"')
    expect(html).toContain("Falcons")
    expect(html).toContain("scorer on 1 match")
    expect(html).toContain("backup scorer on 1 match")
  })
  it("marks a member with no operational assignments as None", () => {
    const html = render(member, { [member.id]: { managedTeams: [], scoringMatches: [], isComplete: true } })
    expect(html).toContain("Assignments")
    expect(html).toContain("None")
  })
  it("names the blocking assignments inside the removal confirmation", () => {
    const source = readFileSync(new URL("../components/users/user-list-table.tsx", import.meta.url), "utf8")
    expect(source).toContain("Listed blockers:")
    expect(source).toContain("describeAssignments")
    expect(source).toContain("Assignments are rechecked on removal")
  })
  it("does not misrepresent an unloaded assignment map as None", () => {
    const html = render()
    expect(html).toContain("Assignments not loaded")
    expect(html).not.toContain(">None<")
  })
  it("does not misrepresent an empty truncated result as None", () => {
    const html = render(member, { [member.id]: { managedTeams: [], scoringMatches: [], isComplete: false } })
    expect(html).toContain("No assignments in loaded results")
    expect(html).toContain("Additional assignments may block removal")
    expect(html).not.toContain(">None<")
  })
  it("labels counts as lower bounds when assignments are truncated", () => {
    const html = render(member, { [member.id]: { managedTeams: [{ id: "team-1", name: "Falcons" }], scoringMatches: [], isComplete: false } })
    expect(html).toContain("At least: manages 1 team")
    expect(html).toContain("Partial assignment list")
  })
  it("escapes assignment names rather than rendering markup", () => {
    const html = render(member, { [member.id]: { managedTeams: [{ id: "team-1", name: "<script>bad</script>" }], scoringMatches: [], isComplete: true } })
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;")
    expect(html).not.toContain("<script>")
  })
})
