import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MemberDirectoryControls, MemberDirectoryNavigation } from "@/components/users/member-directory-controls"
import { memberDirectoryFilters } from "@/lib/member-directory-filters"

// Client table rendering is covered in member-view.test.tsx; controls are server components.
describe("Server-rendered member directory controls", () => {
  it("uses labelled whole-league GET filters and deliberately omits the old cursor", () => {
    const filters = memberDirectoryFilters.parse({ q: "Ali", role: "scorer", status: "active", after: "00000000-0000-4000-8000-000000000001" })
    const html = renderToStaticMarkup(<MemberDirectoryControls filters={filters} />)
    expect(html).toContain('method="get"')
    expect(html).toContain('action="/dashboard/settings/members"')
    expect(html).toContain('for="member-query"')
    expect(html).toContain('for="member-status"')
    expect(html).toContain('for="member-role"')
    expect(html).toMatch(/maxlength="100"/i)
    expect(html).not.toContain('name="after"')
    expect(html).toContain("Search covers this league, not just the current page")
  })
  it("shows invalid-input feedback rather than an empty directory", () => {
    const html = renderToStaticMarkup(<MemberDirectoryControls filters={memberDirectoryFilters.parse({})} invalid />)
    expect(html).toContain('role="alert"')
    expect(html).toContain("Invalid member filters or page cursor")
  })
  it("retains filters in navigation and avoids fabricated page counts", () => {
    const filters = memberDirectoryFilters.parse({ q: "Ali", role: "scorer", after: "00000000-0000-4000-8000-000000000001" })
    const html = renderToStaticMarkup(<MemberDirectoryNavigation filters={filters} nextCursor="00000000-0000-4000-8000-000000000002" />)
    expect(html).toContain("First results page")
    expect(html).toContain("Next members")
    expect(html).toContain("q=Ali&amp;role=scorer&amp;after=")
    expect(html).toContain('aria-label="Member directory pages"')
  })
  it("does not offer a next page without an observed sentinel", () => {
    const html = renderToStaticMarkup(<MemberDirectoryNavigation filters={memberDirectoryFilters.parse({})} nextCursor={null} />)
    expect(html).not.toContain("Next members")
    expect(html).not.toContain("First results page")
  })
})
