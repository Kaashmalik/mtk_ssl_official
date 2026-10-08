import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { TeamsClient } from "./teams-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Teams",
  description: "Manage all cricket teams across SSL tournaments. View team rosters, captains, home grounds, and tournament affiliations.",
  path: "/teams",
});

export default function TeamsPage() {
  return (
    <AdminLayout>
      <TeamsClient />
    </AdminLayout>
  );
}
