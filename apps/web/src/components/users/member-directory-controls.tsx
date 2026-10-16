import React from "react"
import Link from "next/link"
import { memberDirectoryHref, memberDirectoryRoles, type MemberDirectoryFilters } from "@/lib/member-directory-filters"

export function MemberDirectoryControls({ filters, invalid = false }: { filters: MemberDirectoryFilters; invalid?: boolean }) {
  return <div className="space-y-3">
    <form method="get" action="/dashboard/settings/members" className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <label htmlFor="member-query" className="block text-sm font-medium">Search all league members</label>
        <input id="member-query" name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="Name or email" className="min-h-11 rounded-md border bg-background px-3" />
      </div>
      <div className="space-y-1">
        <label htmlFor="member-status" className="block text-sm font-medium">League access</label>
        <select id="member-status" name="status" defaultValue={filters.status} className="min-h-11 rounded-md border bg-background px-3">
          <option value="all">All access states</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="member-role" className="block text-sm font-medium">League role</label>
        <select id="member-role" name="role" defaultValue={filters.role} className="min-h-11 rounded-md border bg-background px-3">
          {memberDirectoryRoles.map(role => <option key={role} value={role}>{role === "all" ? "All roles" : role.replaceAll("_", " ")}</option>)}
        </select>
      </div>
      <button type="submit" className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground">Search members</button>
      <Link href="/dashboard/settings/members" className="inline-flex min-h-11 items-center underline">Reset directory</Link>
    </form>
    {invalid && <p role="alert" className="text-destructive">Invalid member filters or page cursor. Use one value per filter, a name/email up to 100 characters, and a listed role/access state.</p>}
    <p className="text-sm text-muted-foreground">Search covers this league, not just the current page. Changing filters starts at the first page.</p>
  </div>
}

export function MemberDirectoryNavigation({ filters, nextCursor }: { filters: MemberDirectoryFilters; nextCursor: string | null }) {
  return <nav aria-label="Member directory pages" className="flex flex-wrap gap-4">
    {filters.after && <Link href={memberDirectoryHref(filters)} className="inline-flex min-h-11 items-center underline">First results page</Link>}
    {nextCursor && <Link href={memberDirectoryHref(filters, nextCursor)} className="inline-flex min-h-11 items-center underline">Next members</Link>}
    <p className="text-sm text-muted-foreground">Results are ordered by membership ID. Memberships may change between pages.</p>
  </nav>
}
