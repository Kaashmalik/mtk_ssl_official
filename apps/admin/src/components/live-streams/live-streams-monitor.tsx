"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { RefreshCw, ExternalLink } from "lucide-react";

interface StreamRow {
  id: string;
  tenantName: string | null;
  teamAName: string;
  teamBName: string;
  streamSource: string | null;
  streamStatus: string;
  liveStreamUrl: string | null;
  status: string;
}

export function LiveStreamsMonitor() {
  const [rows, setRows] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/live-streams");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.streams ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const live = rows.filter((r) => r.streamStatus === "live");
  const configured = rows.filter((r) => r.streamStatus !== "idle");

  return (
    <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Live Stream Control Center</CardTitle>
            <CardDescription>
              {live.length} live now · {configured.length} configured across all leagues
            </CardDescription>
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
          <p className="text-sm text-muted-foreground">Loading streams…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 text-left font-medium">Match</th>
                  <th className="py-2 text-left font-medium">League</th>
                  <th className="py-2 text-left font-medium">Source</th>
                  <th className="py-2 text-left font-medium">Stream</th>
                  <th className="py-2 text-left font-medium">Match Status</th>
                  <th className="py-2 text-right font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {configured.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{s.teamAName} vs {s.teamBName}</td>
                    <td className="py-2 text-xs text-muted-foreground">{s.tenantName}</td>
                    <td className="py-2 capitalize">{s.streamSource ?? "—"}</td>
                    <td className="py-2">
                      {s.streamStatus === "live"
                        ? <Badge className="bg-red-600 text-white">LIVE</Badge>
                        : <Badge variant="secondary">{s.streamStatus}</Badge>}
                    </td>
                    <td className="py-2 text-xs capitalize">{s.status}</td>
                    <td className="py-2 text-right">
                      <a href={`/matches/${s.id}/live`} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm">
                          <ExternalLink className="h-4 w-4 mr-1" /> Open
                        </Button>
                      </a>
                    </td>
                  </tr>
                ))}
                {configured.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No streams configured yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}