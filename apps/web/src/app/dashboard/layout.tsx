import React from "react"
import { auth } from "@clerk/nextjs/server"
import { getDashboardContext, type DashboardContext } from "@/lib/dashboard-context"
import { DashboardShell } from "./dashboard-shell"
import { TrialBannerServer } from "@/components/billing/trial-banner-server"
import type { UserRole } from "@/lib/rbac"
import { hasPermission } from "@/lib/rbac"

/** Auth + tenant data — never statically prerender dashboard pages. */
export const dynamic = "force-dynamic"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Resolve the user's role on the server so we can filter navigation
    let userRole: UserRole = "fan"
    let context: DashboardContext | null = null
    try {
        const { userId } = await auth()
        if (userId) {
            const access = await getDashboardContext(userId)
            if (access.status === "ready") {
                context = access.context
                userRole = context.role
            }
        }
    } catch {
        // Fallback to 'fan' (minimal access) if role lookup fails
    }

    return (
        <DashboardShell userRole={userRole} banner={context && hasPermission(context.role, "settings:manage") ? <TrialBannerServer context={context} /> : null}>
            {children}
        </DashboardShell>
    )
}
