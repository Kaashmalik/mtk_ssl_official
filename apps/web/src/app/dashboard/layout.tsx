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
    let blocked = "Sign in to access a league workspace."
    try {
        const { userId } = await auth()
        if (userId) {
            const access = await getDashboardContext(userId)
            if (access.status === "ready") {
                context = access.context
                userRole = context.role
                blocked = ""
            } else if (access.status === "no-tenant") {
                // Authenticated active accounts still need the league setup page.
                blocked = ""
            } else {
                blocked = access.status === "unavailable" ? "Workspace access is temporarily unavailable. Please retry."
                    : "You do not have active access to this league. Contact the organizer."
            }
        }
    } catch {
        blocked = "Workspace access is temporarily unavailable. Please retry."
    }

    return (
        <DashboardShell userRole={userRole} banner={context && hasPermission(context.role, "settings:manage") ? <TrialBannerServer context={context} /> : null}>
            {blocked ? <p role="alert">{blocked}</p> : children}
        </DashboardShell>
    )
}
