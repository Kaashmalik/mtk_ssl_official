"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button } from "@mtk/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select";
import { RefreshCw } from "lucide-react";

interface SubRow {
  id: string;
  tenantName: string | null;
  tenantSlug: string | null;
  plan: string;
  status: string;
  monthlyAmount: string;
  currentPeriodEnd: string | null;
  state: string;
  daysLeft: number | null;
}

const STATE_COLORS: Record<string, string> = {
  active: "bg-green-600 text-white",
  expiring: "bg-amber-500 text-white",
  critical: "bg-orange-600 text-white",
  grace: "bg-yellow-500 text-black",
  expired: "bg-red-600 text-white",
  trialing: "bg-purple-600 text-white",
};

const QUICK_EXTENSIONS = [7, 30, 90, 365];
const PLANS = ["free", "starter", "pro", "enterprise"] as const;

export function SubscriptionLifecycle() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/lifecycle");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.subscriptions ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch("/api/subscriptions/lifecycle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Subscription Lifecycle</CardTitle>
            <CardDescription>Countdown, manual extensions, and plan overrides for every league.</CardDescription>
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
          <p className="text-sm text-muted-foreground">Loading subscriptions…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 text-left font-medium">League</th>
                  <th className="py-2 text-left font-medium">Plan</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Period End</th>
                  <th className="py-2 text-left font-medium">Extend</th>
                  <th className="py-2 text-left font-medium">Override Plan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2">
                      <p className="font-medium">{r.tenantName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{r.tenantSlug}</p>
                    </td>
                    <td className="py-2 capitalize">{r.plan}</td>
                    <td className="py-2">
                      <Badge className={STATE_COLORS[r.state] ?? "bg-muted"}>
                        {r.state}{r.daysLeft !== null ? ` · ${r.daysLeft}d` : ""}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        {QUICK_EXTENSIONS.map((d) => (
                          <Button
                            key={d}
                            size="sm"
                            variant="outline"
                            disabled={busy === r.id}
                            onClick={() => act(r.id, { action: "extend_days", days: d, reason: `+${d} days` })}
                          >
                            +{d}d
                          </Button>
                        ))}
                      </div>
                    </td>
                    <td className="py-2">
                      <Select
                        value={r.plan}
                        onValueChange={(v) => act(r.id, { action: "set_plan", plan: v, reason: "Manual override" })}
                      >
                        <SelectTrigger className="w-36" disabled={busy === r.id}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PLANS.map((p) => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No subscriptions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}