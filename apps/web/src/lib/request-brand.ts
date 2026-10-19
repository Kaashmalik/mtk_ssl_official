import { cache } from "react"
import { auth } from "@clerk/nextjs/server"
import { getDashboardContext } from "./dashboard-context"
import { getTenantBranding, getTenantFromRequest } from "./tenant"
import { brandPresentation } from "./brand-presentation"

/** Request-local only: never cache one tenant's brand globally or pass the raw row to a client. */
export const readRequestBrand = cache(async () => {
  const hostTenant = await getTenantFromRequest(true)
  if (hostTenant) return hostTenant.isActive ? brandPresentation(await getTenantBranding(hostTenant.id)) : null
  const { userId } = await auth()
  if (!userId) return null
  const access = await getDashboardContext(userId)
  if (access.status !== "ready") return null
  return brandPresentation(await getTenantBranding(access.context.tenantId))
})
