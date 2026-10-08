import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { LiveStreamsMonitor } from "@/components/live-streams/live-streams-monitor";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Live Streams",
  description: "Monitor every active live stream across all leagues.",
  path: "/live-streams",
});

export default function LiveStreamsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Streams</h1>
          <p className="text-muted-foreground mt-2">
            Operational view of all configured and currently running streams.
          </p>
        </div>
        <LiveStreamsMonitor />
      </div>
    </AdminLayout>
  );
}

export const dynamic = "force-dynamic";