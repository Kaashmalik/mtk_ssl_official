import { db, tenants } from "@mtk/database"
import { desc } from "drizzle-orm"

/**
 * Super-admin platform reads. These are intentionally cross-tenant — the
 * boundary is the super-admin gate in the caller (route-level `isSuperAdmin`),
 * not a tenant predicate; there is no "exact league" here. Projections stay
 * bounded in fields and rows like every other list read.
 */

/** Hard bound on the platform league list (super-admin surface). */
export const adminLeagueListLimit = 500

export interface AdminLeagueRow {
  id: string
  name: string
  slug: string
  plan: string
  customDomain: string | null
  isActive: boolean
  createdAt: Date
}

/** Every league on the platform, newest first, projected to the admin fields. */
export async function listAllLeaguesForAdmin(): Promise<AdminLeagueRow[]> {
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      customDomain: tenants.customDomain,
      isActive: tenants.isActive,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(adminLeagueListLimit)
}
