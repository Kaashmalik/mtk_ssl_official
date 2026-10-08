import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { LiveScoringClient } from "./live-scoring-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Live Scoring",
  description: "Real-time ball-by-ball live scoring interface for all active SSL cricket matches.",
  path: "/live-scoring",
});

export default function LiveScoringPage() {
  return (
    <AdminLayout>
      <LiveScoringClient />
    </AdminLayout>
  );
}
