import type { Metadata } from "next";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AuditLogViewer } from "@/components/audit/audit-log-viewer";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Audit Logs",
  description: "Filterable history of all administrative actions across the platform.",
  path: "/audit-logs",
});

export default function AuditLogsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground mt-2">
            Immutable record of admin actions, role changes, and impersonation sessions.
          </p>
        </div>
        <AuditLogViewer />
      </div>
    </AdminLayout>
  );
}

export const dynamic = "force-dynamic";