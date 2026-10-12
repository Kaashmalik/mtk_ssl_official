import { users, userTenantRoles } from "@mtk/database"
import { sql } from "drizzle-orm"

/** Junction roles take precedence; legacy membership is only a fallback. */
export function scorerMembership(tenantId: string) {
  return sql`(
    EXISTS (SELECT 1 FROM ${userTenantRoles}
      WHERE ${userTenantRoles.userId} = ${users.id}
        AND ${userTenantRoles.tenantId} = ${tenantId}
        AND ${userTenantRoles.role} = 'scorer')
    OR (NOT EXISTS (SELECT 1 FROM ${userTenantRoles}
      WHERE ${userTenantRoles.userId} = ${users.id}
        AND ${userTenantRoles.tenantId} = ${tenantId})
      AND ${users.role} = 'scorer' AND ${tenantId} = ANY(${users.tenantIds}))
  )`
}
