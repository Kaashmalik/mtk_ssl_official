"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { Button } from "@mtk/ui";
import { Input } from "@mtk/ui";
import { Trash2, Search, Download, Users, Mail, Calendar } from "lucide-react";

export function WaitlistManagement() {
  const [entries, setEntries] = useState<any[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWaitlist();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredEntries(entries);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredEntries(
        entries.filter(
          (entry) =>
            entry.name?.toLowerCase().includes(q) ||
            entry.email?.toLowerCase().includes(q)
        )
      );
    }
  }, [searchQuery, entries]);

  async function fetchWaitlist() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist");
      if (!res.ok) {
        throw new Error("Failed to fetch waitlist entries");
      }
      const data = await res.json();
      setEntries(data.waitlist || []);
      setFilteredEntries(data.waitlist || []);
    } catch (err: any) {
      console.error("Failed to fetch waitlist:", err);
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this entry from the waitlist?")) {
      return;
    }

    try {
      const res = await fetch(`/api/waitlist?id=${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setEntries(entries.filter((entry) => entry.id !== id));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete entry");
      }
    } catch (err) {
      console.error("Failed to delete waitlist entry:", err);
      alert("An error occurred while deleting the entry");
    }
  }

  function handleExport() {
    if (filteredEntries.length === 0) return;

    const headers = ["Name", "Email", "Signed Up At"];
    const rows = filteredEntries.map((e) => [
      e.name || "",
      e.email || "",
      e.createdAt ? new Date(e.createdAt).toLocaleString() : "",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.map((val) => `"${val.replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ssl_waitlist_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Signups</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : entries.length}</div>
            <p className="text-xs text-muted-foreground">All time pre-launch leads</p>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading
                ? "..."
                : entries.filter((e) => {
                    const oneWeekAgo = new Date();
                    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                    return e.createdAt && new Date(e.createdAt) > oneWeekAgo;
                  }).length}
            </div>
            <p className="text-xs text-muted-foreground">Signups in last 7 days</p>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading
                ? "..."
                : entries.filter((e) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return e.createdAt && new Date(e.createdAt) > today;
                  }).length}
            </div>
            <p className="text-xs text-muted-foreground">Signups today</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Waitlist Entries</CardTitle>
              <CardDescription>View and manage your pre-launch marketing waitlist leads</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredEntries.length === 0} className="h-9">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive mb-4">
              Error loading waitlist: {error}. Please try again later.
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between border-b border-border/40 pb-4 last:border-0 last:pb-0">
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="h-8 w-8 bg-muted rounded-lg animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground text-sm">
                {searchQuery ? "No matching entries found" : "No waitlist entries yet"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border/40 pb-2 text-muted-foreground">
                    <th className="pb-3 font-semibold">Name</th>
                    <th className="pb-3 font-semibold">Email</th>
                    <th className="pb-3 font-semibold">Signed Up</th>
                    <th className="pb-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="group hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 font-medium">{entry.name}</td>
                      <td className="py-3.5 text-muted-foreground">{entry.email}</td>
                      <td className="py-3.5 text-muted-foreground">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "N/A"}
                      </td>
                      <td className="py-3.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(entry.id)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
