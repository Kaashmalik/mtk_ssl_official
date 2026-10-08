import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { CommissionManagement } from "@/components/commission/commission-management";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Commission Rates",
  description: "Configure platform commission rates for each subscription plan. Default rate is 15% per plan.",
  path: "/commission",
});

export default function CommissionPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Commission Rates</h1>
          <p className="text-muted-foreground mt-2">
            Control platform commission rates for each plan (default 15%).
          </p>
        </div>
        <CommissionManagement />
      </div>
    </AdminLayout>
  );
}

