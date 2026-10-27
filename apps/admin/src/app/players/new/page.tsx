import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { NewPlayerForm } from "./new-player-form";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Create Player",
  description: "Create a cricket player record inside an SSL league and, optionally, a team.",
  path: "/players/new",
});

export default function NewPlayerPage() {
  return (
    <AdminLayout>
      <NewPlayerForm />
    </AdminLayout>
  );
}
