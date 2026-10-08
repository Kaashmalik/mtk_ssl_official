import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { MatchesClient } from "./matches-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Matches",
  description: "View and manage all cricket matches across all SSL tournaments. Schedule, update scores, and track match status.",
  path: "/matches",
});

export default function MatchesPage() {
  return (
    <AdminLayout>
      <MatchesClient />
    </AdminLayout>
  );
}
