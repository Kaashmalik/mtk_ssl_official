import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { buildMetadata } from "@/lib/seo";
import { NewTenantForm } from "./new-tenant-form";

export const metadata: Metadata = buildMetadata({
  title: "New Tenant",
  description: "Create a new tenant organisation on the SSL platform.",
  path: "/tenants/new",
});

export default function NewTenantPage() {
  return <AdminLayout><NewTenantForm /></AdminLayout>;
}
