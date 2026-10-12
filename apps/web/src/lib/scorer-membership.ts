import { users, userTenantRoles } from "@mtk/database"
import { sql } from "drizzle-orm"

/** Only an explicit active league membership can be assigned as scorer. */
export function scorerMembership(tenantId: string) {
  return sql`(
    ${users.isActive} = true AND EXISTS (SELECT 1 FROM ${userTenantRoles}
      WHERE ${userTenantRoles.userId} = ${users.id}
        AND ${userTenantRoles.tenantId} = ${tenantId}
        AND ${userTenantRoles.role} = 'scorer'
        AND ${userTenantRoles.status} = 'active')
  )`
}
