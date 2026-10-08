import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { NewTournamentForm } from "./new-tournament-form";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "New Tournament",
  description: "Create a new cricket tournament. Set format, dates, team limits, and registration deadlines.",
  path: "/tournaments/new",
});

export default function NewTournamentPage() {
  return <AdminLayout><NewTournamentForm /></AdminLayout>;
}
