import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { LeagueApplicationsManagement } from "@/components/onboarding/league-applications-management";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "League Applications",
  description: "Review league onboarding applications and activate workspaces.",
  path: "/league-applications",
});

export default function LeagueApplicationsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">League Applications</h1>
          <p className="text-muted-foreground mt-2">
            Review league onboarding applications. Approval provisions exactly one free-tier workspace for the
            applicant; paid plans keep flowing through the subscription request flow.
          </p>
        </div>
        <LeagueApplicationsManagement />
      </div>
    </AdminLayout>
  );
}
