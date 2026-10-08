"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { Button } from "@mtk/ui";
import { Input } from "@mtk/ui";

type ImpersonationState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; targetEmail: string; targetId: string }
  | { phase: "error"; message: string };

export function UsersManagement() {
  const [searchEmail, setSearchEmail] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<ImpersonationState>({ phase: "idle" });

  async function handleImpersonate() {
    if (!searchEmail.trim()) return;
    setState({ phase: "loading" });

    try {
      const res = await fetch("/api/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: searchEmail.trim(), reason: reason.trim() || undefined }),
      });

      const data = await res.json();

      if (res.ok) {
        setState({
          phase: "success",
          targetEmail: data.targetUser?.email ?? searchEmail,
          targetId: data.targetUser?.id ?? "unknown",
        });
        // Hand the one-time token to the web app, which consumes it and shows
        // the "viewing as" banner.
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
        }
      } else {
        setState({ phase: "error", message: data.error ?? "Impersonation failed" });
      }
    } catch {
      setState({ phase: "error", message: "Network error — try again" });
    }
  }

  async function handleEndImpersonation() {
    try {
      await fetch("/api/impersonate", { method: "DELETE" });
      setState({ phase: "idle" });
      setSearchEmail("");
      setReason("");
    } catch {
      // Silent — best-effort revoke
    }
  }

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>Impersonate User</CardTitle>
        <CardDescription>
          Enter a user email to impersonate them. A 5-minute, single-use,
          signed session will be created and audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Success state ── */}
        {state.phase === "success" ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-600 dark:text-green-400">
              ✅ Impersonation session active for{" "}
              <strong>{state.targetEmail}</strong> (id: {state.targetId.slice(0, 8)}…).
              <br />
              The session cookie has been set and will be consumed on first use.
            </div>
            <Button variant="outline" onClick={handleEndImpersonation}>
              End Impersonation
            </Button>
          </div>
        ) : (
          <>
            {/* ── Form ── */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  className="flex-1"
                  disabled={state.phase === "loading"}
                />
                <Button
                  onClick={handleImpersonate}
                  disabled={state.phase === "loading" || !searchEmail.trim()}
                >
                  {state.phase === "loading" ? "Issuing…" : "Impersonate"}
                </Button>
              </div>
              <Input
                placeholder="Reason for impersonation (optional, logged)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={state.phase === "loading"}
              />
            </div>

            {/* ── Error ── */}
            {state.phase === "error" && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600 dark:text-red-400">
                ❌ {state.message}
              </div>
            )}
          </>
        )}

        {/* ── Warning ── */}
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm text-yellow-600 dark:text-yellow-400">
          ⚠️ <strong>Privileged action.</strong> All impersonation events are
          audit-logged with your admin identity, IP address, and timestamp.
          Sessions are single-use and expire after 5 minutes.
        </div>
      </CardContent>
    </Card>
  );
}
