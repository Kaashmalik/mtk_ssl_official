import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { TenantDetail } from "./tenant-detail";
import { buildMetadata } from "@/lib/seo";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return buildMetadata({
    title: `Tenant ${id}`,
    description: `Manage tenant details, branding, tournaments, teams, and venues for SSL organisation ${id}.`,
    path: `/tenants/${id}`,
  });
}

export default function TenantDetailPage() {
  return (
    <AdminLayout>
      <TenantDetail />
    </AdminLayout>
  );
}
