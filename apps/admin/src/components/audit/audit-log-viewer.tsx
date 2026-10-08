"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { RefreshCw } from "lucide-react";

interface AuditRow {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  method: string;
  path: string;
  ip: string | null;
  statusCode: string | null;
  payload: unknown;
  createdAt: string;
}

export function AuditLogViewer() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/audit-logs?limit=200");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.logs ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Audit Log</CardTitle>
            <CardDescription>Every administrative action, role change, and impersonation session.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading audit logs…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 text-left font-medium">When</th>
                  <th className="py-2 text-left font-medium">Actor</th>
                  <th className="py-2 text-left font-medium">Action</th>
                  <th className="py-2 text-left font-medium">Path</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2">
                      <p className="text-sm">{r.actorEmail ?? "system"}</p>
                      {r.actorRole && <p className="text-xs text-muted-foreground">{r.actorRole}</p>}
                    </td>
                    <td className="py-2"><Badge variant="outline">{r.method}</Badge></td>
                    <td className="py-2 text-xs font-mono">{r.path}</td>
                    <td className="py-2 text-xs">{r.statusCode ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground max-w-xs truncate">
                      {r.payload ? JSON.stringify(r.payload) : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No audit entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}