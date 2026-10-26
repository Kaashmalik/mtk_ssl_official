import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { ApprovalQueue } from "@/components/approvals/approval-queue";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Approvals",
  description: "Two-person approval queue for destructive platform actions.",
  path: "/approvals",
});

export default function ApprovalsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
          <p className="text-muted-foreground mt-2">
            Destructive actions run only after a second super admin approves them. Requests expire after 24 hours.
          </p>
        </div>
        <ApprovalQueue />
      </div>
    </AdminLayout>
  );
}

export const dynamic = "force-dynamic";
