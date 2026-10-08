import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { DashboardOverview } from "@/components/dashboard/overview";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Dashboard",
  description: "Overview of the Shakir Super League platform — active tenants, live matches, revenue metrics, and system health at a glance.",
  path: "/",
});

export default function AdminPage() {
  return (
    <AdminLayout>
      <DashboardOverview />
    </AdminLayout>
  );
}
