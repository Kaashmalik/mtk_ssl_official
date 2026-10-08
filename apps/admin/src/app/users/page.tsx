import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { UsersManagement } from "@/components/users/users-management";
import { UsersGrid } from "@/components/users/users-grid";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Users Management",
  description: "View all registered SSL users and initiate admin impersonation sessions for support and debugging purposes.",
  path: "/users",
});

export default function UsersPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users Management</h1>
          <p className="text-muted-foreground mt-2">
            View all users and impersonate them for support purposes.
          </p>
        </div>
        <UsersGrid />
        <UsersManagement />
      </div>
    </AdminLayout>
  );
}

