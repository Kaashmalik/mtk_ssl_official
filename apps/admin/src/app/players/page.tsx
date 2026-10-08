import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PlayersClient } from "./players-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Players",
  description: "Browse and manage all cricket players registered across SSL teams. View profiles, roles, batting and bowling stats.",
  path: "/players",
});

export default function PlayersPage() {
  return (
    <AdminLayout>
      <PlayersClient />
    </AdminLayout>
  );
}
