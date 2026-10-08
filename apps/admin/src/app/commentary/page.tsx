import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { CommentaryClient } from "./commentary-client";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Commentary",
  description: "Add and manage multilingual ball-by-ball commentary for SSL cricket matches. AI-assisted generation is Beta.",
  path: "/commentary",
});

export default function CommentaryPage() {
  return (
    <AdminLayout>
      <CommentaryClient />
    </AdminLayout>
  );
}
