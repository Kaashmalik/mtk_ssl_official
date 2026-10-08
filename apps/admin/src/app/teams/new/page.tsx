import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { NewTeamForm } from "./new-team-form";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "New Team",
  description: "Register a new cricket team in an SSL tenant and optionally assign it to a tournament.",
  path: "/teams/new",
});

export default function NewTeamPage() {
  return <AdminLayout><NewTeamForm /></AdminLayout>;
}
