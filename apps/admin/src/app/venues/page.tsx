import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { VenuesClient } from "./venues-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Venues",
  description: "Manage cricket venues across all SSL tenant organisations. View capacity, ground type, location, and tenant association.",
  path: "/venues",
});

export default function VenuesPage() {
  return (
    <AdminLayout>
      <VenuesClient />
    </AdminLayout>
  );
}
