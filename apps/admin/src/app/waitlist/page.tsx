import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { WaitlistManagement } from "@/components/marketing/waitlist-management";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Waitlist",
  description: "View and manage waitlist registrations from the marketing website.",
  path: "/waitlist",
});

export default function WaitlistPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Waitlist Management</h1>
          <p className="text-muted-foreground mt-2">
            Monitor and manage pre-launch signups from the marketing page.
          </p>
        </div>
        <WaitlistManagement />
      </div>
    </AdminLayout>
  );
}
