"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mtk/ui";
import { CheckCircle2, HelpCircle, RefreshCw, XCircle } from "lucide-react";

interface ApplicationRow {
  id: string;
  applicantId: string;
  proposedName: string;
  proposedSlug: string;
  desiredPlan: string;
  state: string;
  version: number;
  reviewReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  provisionedTenantId: string | null;
  createdAt: string;
  updatedAt: string;
  applicantEmail: string;
  applicantName: string | null;
  applicantActive: boolean;
  replies?: Array<{ id: string; body: string; createdAt: string }>;
}

const STATE_FILTERS = [
  { value: "submitted", label: "Submitted" },
  { value: "needs_information", label: "Information requested" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
] as const;

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_information: "Information requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function LeagueApplicationsManagement() {
  const [statusFilter, setStatusFilter] = useState<string>("submitted");
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; action: "reject" | "request_information" } | null>(null);
  const [reason, setReason] = useState("");

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/league-applications?status=${encodeURIComponent(statusFilter)}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to load applications");
      setRows(payload.applications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const review = async (
    row: ApplicationRow,
    action: "approve" | "reject" | "request_information",
    reasonText?: string,
  ) => {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/league-applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: row.id,
          action,
          expectedVersion: row.version,
          reason: reasonText ?? null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to review the application");
      setReasonFor(null);
      setReason("");
      await fetchApplications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review the application");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Queue</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-56" aria-label="Application status filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATE_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={fetchApplications} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading applications…</p>}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No applications in this state.</p>
      )}

      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                {row.proposedName}
                <Badge variant="outline">{STATE_LABELS[row.state] ?? row.state}</Badge>
                {!row.applicantActive && <Badge variant="destructive">Inactive applicant</Badge>}
              </CardTitle>
              <CardDescription className="text-xs">version {row.version}</CardDescription>
            </div>
            <CardDescription>
              {row.applicantName ? `${row.applicantName} · ` : ""}{row.applicantEmail} · proposed URL:{" "}
              <span className="font-mono">{row.proposedSlug}</span> · preferred plan: {row.desiredPlan}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1 text-sm text-muted-foreground">
              <span>Created: {formatDate(row.createdAt)}</span>
              <span>Submitted: {formatDate(row.submittedAt)}</span>
              <span>Last reviewed: {formatDate(row.reviewedAt)}</span>
              {row.provisionedTenantId && <span>Provisioned tenant: {row.provisionedTenantId}</span>}
              {row.reviewReason && (
                <span>
                  <span className="font-medium">Review note:</span> {row.reviewReason}
                </span>
              )}
            </div>

            {row.replies && row.replies.length > 0 && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <span className="font-medium">Applicant answers (ENH-02-02 thread)</span>
                {row.replies.map((reply) => (
                  <p key={reply.id} className="rounded-md border bg-muted/30 p-2">
                    {reply.body}
                    <span className="ml-2 text-xs opacity-70">{formatDate(reply.createdAt)}</span>
                  </p>
                ))}
              </div>
            )}

            {reasonFor?.id === row.id ? (
              <div className="space-y-2">
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={
                    reasonFor.action === "reject"
                      ? "Why is this application rejected? The applicant sees this note."
                      : "What information does the applicant need to provide?"
                  }
                  rows={3}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={reasonFor.action === "reject" ? "destructive" : "default"}
                    disabled={busyId === row.id || reason.trim().length === 0}
                    onClick={() => review(row, reasonFor.action, reason.trim())}
                  >
                    {reasonFor.action === "reject" ? "Confirm rejection" : "Send request"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.id}
                    onClick={() => {
                      setReasonFor(null);
                      setReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {row.state === "submitted" && (
                  <Button size="sm" disabled={busyId === row.id} onClick={() => review(row, "approve")}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve & activate
                  </Button>
                )}
                {(row.state === "submitted" || row.state === "needs_information") && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setReasonFor({ id: row.id, action: "request_information" });
                        setReason("");
                      }}
                    >
                      <HelpCircle className="mr-2 h-4 w-4" />
                      Request information
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setReasonFor({ id: row.id, action: "reject" });
                        setReason("");
                      }}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
