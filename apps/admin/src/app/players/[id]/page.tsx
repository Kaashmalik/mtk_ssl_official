import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PlayerDetail } from "./player-detail";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Player",
  description: "Player profile, cricket role and league membership detail for platform administrators.",
  path: "/players",
});

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminLayout>
      <PlayerDetail playerId={id} />
    </AdminLayout>
  );
}
