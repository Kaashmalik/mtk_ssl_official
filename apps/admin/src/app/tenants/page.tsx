import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { TenantList } from "@/components/tenants/tenant-list";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Tenants",
  description: "Manage all organisations registered on the SSL platform. View, create, edit, and delete tenant accounts.",
  path: "/tenants",
});

export default function TenantsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground mt-2">
            Manage all organizations using the SSL platform. View, create, edit, or delete tenants.
          </p>
        </div>
        <TenantList />
      </div>
    </AdminLayout>
  );
}
