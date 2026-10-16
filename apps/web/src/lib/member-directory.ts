import { db, users, userTenantRoles } from "@mtk/database"
import { and, eq, gt, ilike, or, sql } from "drizzle-orm"
import { z } from "zod"
import { MEMBER_DIRECTORY_PAGE_SIZE, memberDirectoryFilters, type MemberDirectoryRequest } from "./member-directory-filters"

/** Owner-only contact fields. Caller must first authorize the exact active league. */
const memberColumns = {
  id: users.id, email: users.email, displayName: users.displayName,
  avatarUrl: users.avatarUrl, accountActive: users.isActive,
  protectedAccess: sql<boolean>`${users.role} = 'super_admin'`,
  membershipId: userTenantRoles.id, role: userTenantRoles.role,
  status: userTenantRoles.status, version: userTenantRoles.version,
  createdAt: userTenantRoles.createdAt,
}

/** Literal substring search: user-supplied %, _ and backslash are not wildcards. */
function searchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`
}

export async function readMemberDirectory(tenantId: string, input: Omit<MemberDirectoryRequest, "tenantId"> = {}) {
  z.string().uuid().parse(tenantId)
  const filters = memberDirectoryFilters.parse(input)
  const pattern = filters.q ? searchPattern(filters.q) : undefined
  const rows = await db.select(memberColumns).from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(and(
      eq(userTenantRoles.tenantId, tenantId),
      filters.after ? gt(userTenantRoles.id, filters.after) : undefined,
      filters.status !== "all" ? eq(userTenantRoles.status, filters.status) : undefined,
      filters.role !== "all" ? eq(userTenantRoles.role, filters.role) : undefined,
      pattern ? or(ilike(users.email, pattern), ilike(users.displayName, pattern)) : undefined,
    ))
    // Unique ID ordering deliberately makes no chronological-order promise.
    // A cursor remains usable even if that membership was deleted between reads.
    .orderBy(userTenantRoles.id).limit(MEMBER_DIRECTORY_PAGE_SIZE + 1)
  const members = rows.slice(0, MEMBER_DIRECTORY_PAGE_SIZE)
  return {
    members,
    nextCursor: rows.length > MEMBER_DIRECTORY_PAGE_SIZE ? members[members.length - 1].membershipId : null,
  }
}

export async function readMemberDetails(tenantId: string, membershipId: string) {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(membershipId)
  const [member] = await db.select(memberColumns).from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(and(eq(userTenantRoles.tenantId, tenantId), eq(userTenantRoles.id, membershipId)))
    .limit(1)
  return member ?? null
}
