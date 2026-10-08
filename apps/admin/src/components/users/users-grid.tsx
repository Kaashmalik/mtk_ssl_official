"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Button, Input } from "@mtk/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select";
import { RefreshCw } from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  isActive: boolean;
  tenantIds: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = ["super_admin", "league_owner", "team_manager", "coach", "scorer", "player", "fan"] as const;

export function UsersGrid() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextSearch = search) {
    setLoading(true);
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(nextSearch)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setRows(data.users ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patchUser(id: string, patch: { role?: string; isActive?: boolean }) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Update failed");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? data.user : r)));
  }

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>All Users</CardTitle>
            <CardDescription>Search, filter, change roles, and suspend accounts.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
        <Input
          className="mt-2"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
        />
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 text-left font-medium">User</th>
                  <th className="py-2 text-left font-medium">Role</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Last Login</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2">
                      <p className="font-medium">{u.displayName || "—"}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="py-2">
                      <Select value={u.role} onValueChange={(v) => patchUser(u.id, { role: v })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2">
                      {u.isActive
                        ? <Badge className="bg-green-600 text-white">Active</Badge>
                        : <Badge className="bg-yellow-600 text-white">Suspended</Badge>}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant={u.isActive ? "outline" : "default"}
                        size="sm"
                        onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                      >
                        {u.isActive ? "Suspend" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}