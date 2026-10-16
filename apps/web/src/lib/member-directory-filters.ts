import { z } from "zod"

export const MEMBER_DIRECTORY_PAGE_SIZE = 50
export const memberDirectoryRoles = ["all", "league_owner", "team_manager", "coach", "scorer", "player", "fan", "super_admin"] as const
export const memberDirectoryExpiryStates = ["all", "unbounded", "bounded", "expired"] as const
export const memberDirectoryFilters = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "suspended"]).default("all"),
  role: z.enum(memberDirectoryRoles).default("all"),
  /** Expiry-state filter (SCORE-09 surfaces): `expired` uses the database's clock. */
  expiry: z.enum(memberDirectoryExpiryStates).default("all"),
  after: z.string().uuid().optional(),
}).strict()
export const memberDirectoryRequest = memberDirectoryFilters.extend({ tenantId: z.string().uuid() })
export const memberDetailRequest = z.object({ tenantId: z.string().uuid(), membershipId: z.string().uuid() }).strict()
export type MemberDirectoryFilters = z.output<typeof memberDirectoryFilters>
export type MemberDirectoryRequest = z.input<typeof memberDirectoryRequest>
export type MemberDetailRequest = z.input<typeof memberDetailRequest>
export type MemberDirectorySearch = Record<string, string | string[] | undefined>

export function parseMemberDirectorySearch(input: MemberDirectorySearch) {
  // Ignore unrelated URL parameters; repeated supported parameters still fail.
  return memberDirectoryFilters.safeParse({ q: input.q, status: input.status, role: input.role, expiry: input.expiry, after: input.after })
}

export function memberDirectoryHref(filters: MemberDirectoryFilters, after?: string): string {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.status !== "all") params.set("status", filters.status)
  if (filters.role !== "all") params.set("role", filters.role)
  if (filters.expiry !== "all") params.set("expiry", filters.expiry)
  if (after) params.set("after", after)
  const query = params.toString()
  return `/dashboard/settings/members${query ? `?${query}` : ""}`
}
