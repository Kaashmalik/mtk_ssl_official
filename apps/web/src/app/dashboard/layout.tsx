import React from "react"
import { auth } from "@clerk/nextjs/server"
import { getDashboardContext, type DashboardContext } from "@/lib/dashboard-context"
import { reconcileSessionUser } from "@/lib/account-provisioning"
import { PlatformContact } from "@/components/support/platform-contact"
import { DashboardShell } from "./dashboard-shell"
import { TrialBannerServer } from "@/components/billing/trial-banner-server"
import type { UserRole } from "@/lib/rbac"
import { hasPermission } from "@/lib/rbac"
import Link from "next/link"
import { AlertCircle, RefreshCw } from "lucide-react"

/**
 * Auth + tenant data — never statically prerender dashboard pages.
 *
 * ENH-02-01: the blocked states are distinguished truthfully. A delayed or
 * dead Clerk webhook (no local row yet) is PROVISIONING, never "denied" — the
 * layout attempts a bounded server-side reconciliation from the verified
 * session and only then falls back to a notice that never claims the account
 * was refused.
 */
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
    let recovering = false
    try {
        const { userId } = await auth()
        if (userId) {
            let access = await getDashboardContext(userId)
            if (access.status === "provisioning") {
                // One bounded recovery attempt per render: recreate the row
                // from the verified session and re-resolve once. No redirects,
                // so no loop is possible even if recovery keeps failing.
                if (await reconcileSessionUser()) {
                    access = await getDashboardContext(userId)
                }
            }
            if (access.status === "ready") {
                context = access.context
                userRole = context.role
                blocked = ""
            } else if (access.status === "no-tenant") {
                // Authenticated active accounts still need the league setup page.
                blocked = ""
            } else if (access.status === "provisioning") {
                recovering = true
                blocked = "Your account is still being set up. Wait a few seconds and reload this page — if this notice does not clear, contact platform support."
            } else {
                blocked = access.status === "unavailable" ? "Workspace access is temporarily unavailable. Please retry."
                    : "You do not have active access to this league. Contact the organizer."
            }
        }
    } catch (error) {
        console.error("[dashboard-layout] Failed to resolve workspace access", error)
        blocked = "Workspace access is temporarily unavailable. Please retry."
    }

    return (
        <DashboardShell userRole={userRole} banner={context && hasPermission(context.role, "settings:manage") ? <TrialBannerServer context={context} /> : null}>
            {blocked ? (
                <div className="max-w-2xl rounded-2xl border border-warning/30 bg-warning/10 p-6 shadow-sm">
                    <div className="flex gap-4">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                        <div className="space-y-3">
                            <div>
                                <h1 className="font-semibold">Workspace access needs attention</h1>
                                <p className="mt-1 text-sm text-muted-foreground" role="alert">{blocked}</p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <a href="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                                    <RefreshCw className="h-4 w-4" /> Try again
                                </a>
                                <Link href="/" className="inline-flex min-h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium">
                                    Return home
                                </Link>
                            </div>
                        </div>
                    </div>
                    {recovering && (
                        // ENH-02-04: a recovery path that can actually reach a
                        // human — the privacy-conscious WhatsApp contact.
                        <PlatformContact context={{ topic: "recovery" }} className="mt-4 max-w-md" />
                    )}
                </div>
            ) : children}
        </DashboardShell>
    )
}
