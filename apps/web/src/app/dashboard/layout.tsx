import { auth } from "@clerk/nextjs/server"
import { getUserRoleAndTenantIds, getUserRoleForTenant, resolveActiveTenantId } from "@/lib/rbac-server"
import { DashboardShell } from "./dashboard-shell"
import { TrialBannerServer } from "@/components/billing/trial-banner-server"
import type { UserRole } from "@/lib/rbac"

/** Auth + tenant data — never statically prerender dashboard pages. */
export const dynamic = "force-dynamic"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Resolve the user's role on the server so we can filter navigation
    let userRole: UserRole = "fan"
    try {
        const { userId } = await auth()
        if (userId) {
            const tenantId = await resolveActiveTenantId()
            const tenantRole = tenantId ? await getUserRoleForTenant(userId, tenantId) : null
            const record = tenantRole ? null : await getUserRoleAndTenantIds(userId)
            userRole = tenantRole ?? record?.role ?? "fan"
        }
    } catch {
        // Fallback to 'fan' (minimal access) if role lookup fails
    }

    return (
        <DashboardShell userRole={userRole} banner={<TrialBannerServer />}>
            {children}
        </DashboardShell>
    )
}
