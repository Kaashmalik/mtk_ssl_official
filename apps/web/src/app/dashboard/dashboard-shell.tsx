"use client"

import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ImpersonationBanner } from "@/components/layout/impersonation-banner"
import { PageTransition } from "@mtk/ui/components/ui/page-transition"
import type { UserRole } from "@/lib/rbac"

export function DashboardShell({
    children,
    userRole,
    banner,
}: {
    children: React.ReactNode
    userRole: UserRole
    /** Optional server-rendered banner (e.g. trial notice) rendered above the header. */
    banner?: React.ReactNode
}) {
    return (
        <div className="grid min-h-screen w-full md:grid-cols-[auto_1fr]">
            <Sidebar userRole={userRole} />
            <div className="flex flex-col min-h-screen overflow-hidden">
                <ImpersonationBanner />
                {banner}
                <Header userRole={userRole} />
                <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-muted/10">
                    <PageTransition>
                        {children}
                    </PageTransition>
                </main>
            </div>
        </div>
    )
}

