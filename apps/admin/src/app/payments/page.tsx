import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PaymentsApproval } from "@/components/payments/payments-approval";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Payment Approvals",
  description: "Review and approve tenant subscription upgrade requests. Verify payment proofs and manage plan upgrades.",
  path: "/payments",
});

export default function PaymentsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payment Approvals</h1>
          <p className="text-muted-foreground mt-2">
            Review subscription upgrade requests, verify payment receipts, and approve or reject plan changes.
          </p>
        </div>
        <PaymentsApproval />
      </div>
    </AdminLayout>
  );
}
