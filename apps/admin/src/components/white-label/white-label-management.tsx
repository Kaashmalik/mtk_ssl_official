"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { Badge, Button, Input, Textarea } from "@mtk/ui";

export function WhiteLabelManagement() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [adminNotesById, setAdminNotesById] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "revoked">("pending");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/white-label?status=${statusFilter}`);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (error) {
      console.error("Failed to fetch white-label requests:", error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  async function handleReview(requestId: string, status: "approved" | "rejected" | "revoked") {
    try {
      setActionError(null);
      if (status === "rejected" && !adminNotesById[requestId]?.trim()) {
        setActionError("Add a short reason before rejecting this request.");
        return;
      }
      const res = await fetch("/api/white-label", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status, adminNotes: adminNotesById[requestId] || "" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not update this request");
      await fetchRequests();
      setSelectedRequest(null);
      setAdminNotesById((prev) => ({ ...prev, [requestId]: "" }));
    } catch (error) {
      console.error("Failed to review request:", error);
      setActionError(error instanceof Error ? error.message : "Could not update this request");
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="h-32" />
          </Card>
        ))}
      </div>
    );
  }

  const filtered = requests.filter((request) => {
    const name = request.tenants?.name?.toLowerCase() || "";
    const slug = request.tenants?.slug?.toLowerCase() || "";
    const domain = request.custom_domain?.toLowerCase() || "";
    const term = search.toLowerCase().trim();
    if (!term) return true;
    return name.includes(term) || slug.includes(term) || domain.includes(term);
  });

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Branding Approvals</CardTitle>
            <CardDescription>Review and approve league branding, domains, and white-label requests.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={statusFilter === "pending" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("pending")}>Pending</Button>
            <Button variant={statusFilter === "approved" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("approved")}>Approved</Button>
            <Button variant={statusFilter === "rejected" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("rejected")}>Rejected</Button>
            <Button variant={statusFilter === "revoked" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("revoked")}>Revoked</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <Input
            placeholder="Search league, slug, or domain"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <div className="text-xs text-muted-foreground">{filtered.length} request(s)</div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">No requests found</p>
        ) : (
          <div className="space-y-4">
            {filtered.map((request) => (
              <div
                key={request.id}
                className="p-4 rounded-lg bg-muted/30 border border-border/40"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold">
                      {request.tenants?.name || "Unknown League"}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Plan: {request.tenants?.plan} • Requested: {new Date(request.created_at).toLocaleDateString()}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{request.status}</Badge>
                      {request.custom_domain && <Badge variant="secondary">{request.custom_domain}</Badge>}
                      {request.custom_app_name && <Badge variant="secondary">{request.custom_app_name}</Badge>}
                      {request.hide_branding && <Badge variant="secondary">Hide SSL Branding</Badge>}
                    </div>
                    {request.custom_domain && (
                      <div className="text-sm mt-1">Custom Domain: {request.custom_domain}</div>
                    )}
                    {request.reason && (
                      <div className="text-sm text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
                        Reason: {request.reason}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRequest(selectedRequest === request.id ? null : request.id)}
                    >
                      {selectedRequest === request.id ? "Hide" : "Review"}
                    </Button>
                  </div>
                </div>
                {selectedRequest === request.id && (
                  <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
                    {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
                    <Textarea
                      placeholder="Admin notes (optional)"
                      value={adminNotesById[request.id] || ""}
                      onChange={(e) =>
                        setAdminNotesById((prev) => ({ ...prev, [request.id]: e.target.value }))
                      }
                      rows={3}
                    />
                    <div className="flex gap-2">
                      {request.status === "pending" && <>
                        <Button variant="default" size="sm" onClick={() => handleReview(request.id, "approved")}>
                          Approve
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleReview(request.id, "rejected")}>
                          Reject
                        </Button>
                      </>}
                      {request.status === "approved" && (
                        <Button variant="outline" size="sm" onClick={() => handleReview(request.id, "revoked")}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

