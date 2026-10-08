import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { NewMatchForm } from "./new-match-form";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Schedule Match",
  description: "Schedule a new cricket match between two teams in an SSL tournament.",
  path: "/matches/new",
});

export default function NewMatchPage() {
  return <AdminLayout><NewMatchForm /></AdminLayout>;
}
