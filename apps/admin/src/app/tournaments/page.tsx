import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { TournamentsClient } from "./tournaments-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Tournaments",
  description: "Manage all cricket tournaments on the SSL platform. Track formats, schedules, team counts, and tournament status.",
  path: "/tournaments",
});

export default function TournamentsPage() {
  return (
    <AdminLayout>
      <TournamentsClient />
    </AdminLayout>
  );
}
