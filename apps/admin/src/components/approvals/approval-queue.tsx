"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, ShieldAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";

interface Approval {
  id: string;
  action: "tenant.delete";
  targetTenantId: string;
  targetLabel: string;
  reason: string;
  status: "pending" | "executed" | "rejected" | "cancelled" | "expired";
  requestedBy: string;
  requesterEmail: string | null;
  decidedBy: string | null;
  deciderEmail: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
}

type Decision = "approve" | "reject" | "cancel";

const ACTION_LABELS: Record<Approval["action"], string> = {
  "tenant.delete": "Delete league permanently",
};

const STATUS_STYLES: Record<Approval["status"], string> = {
  pending:   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  executed:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  rejected:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  expired:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ApprovalQueue() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-approvals", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load approvals");
      setApprovals(data.approvals ?? []);
      setViewerId(data.viewerId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(approval: Approval, decision: Decision) {
    if (decision === "approve") {
      const typed = prompt(
        `This permanently deletes "${approval.targetLabel}" and all of its data. Type the league name to confirm.`
      );
      if (typed?.trim() !== approval.targetLabel) {
        if (typed !== null) toast.error("The name did not match. Nothing was deleted.");
        return;
      }
    }
    const note = decision === "reject" ? prompt("Why are you rejecting this request? (optional)") : null;

    setBusy(approval.id);
    try {
      const res = await fetch(`/api/admin-approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to record the decision");
      } else {
        toast.success(
          decision === "approve" ? `"${approval.targetLabel}" was deleted.`
            : decision === "reject" ? "Request rejected." : "Request cancelled."
        );
      }
    } catch {
      toast.error("Failed to record the decision");
    } finally {
      setBusy(null);
      load();
    }
  }

  const pending = approvals.filter((a) => a.status === "pending");
  const history = approvals.filter((a) => a.status !== "pending");

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <p className="font-semibold text-destructive">Could not load the approval queue</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="pending-heading" className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
          <h2 id="pending-heading" className="text-sm font-semibold">
            Waiting for a second admin
            {!loading && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{pending.length}</span>
            )}
          </h2>
          <button onClick={load} aria-label="Refresh" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <ShieldAlert className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">Nothing is waiting for approval.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {pending.map((a) => {
              const mine = a.requestedBy === viewerId;
              return (
                <li key={a.id} className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-destructive">{ACTION_LABELS[a.action]}</p>
                    <p className="text-base font-semibold">{a.targetLabel}</p>
                    <p className="text-sm text-foreground/80">“{a.reason}”</p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {mine ? "you" : a.requesterEmail ?? "another admin"} · {formatDate(a.createdAt)} · expires {formatDate(a.expiresAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {mine ? (
                      <>
                        <span className="self-center text-xs text-muted-foreground">Another super admin must review this.</span>
                        <button
                          onClick={() => decide(a, "cancel")}
                          disabled={busy === a.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Cancel request
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => decide(a, "reject")}
                          disabled={busy === a.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                        <button
                          onClick={() => decide(a, "approve")}
                          disabled={busy === a.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                        >
                          {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve and delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!loading && history.length > 0 && (
        <section aria-labelledby="history-heading" className="rounded-xl border border-border/50 bg-card shadow-sm">
          <h2 id="history-heading" className="border-b border-border/40 px-6 py-4 text-sm font-semibold">Recent decisions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  {["League", "Action", "Status", "Requested by", "Decided by", "When"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {history.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-medium">{a.targetLabel}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ACTION_LABELS[a.action]}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[a.status]}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.requesterEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.deciderEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(a.decidedAt ?? a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
