"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Skeleton,
} from "@mtk/ui";

interface Tournament {
  id: string;
  name: string;
  slug: string;
  format: string;
  status: string;
  start_date: string;
  end_date: string;
  max_teams: number;
  tenants: { name: string };
  teams: { count: number }[];
  matches: { count: number }[];
}

const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  draft: "secondary", registration: "default", live: "default",
  completed: "outline", cancelled: "destructive",
};

export function TournamentsClient() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tournaments")
      .then((r) => r.json())
      .then((d) => setTournaments(d.tournaments || []))
      .catch(() => toast.error("Failed to load tournaments"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card><CardContent className="p-6 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tournaments</h1>
          <p className="text-muted-foreground mt-2">Manage cricket tournaments across all tenants.</p>
        </div>
        <Link href="/tournaments/new"><Button>Create Tournament</Button></Link>
      </div>
      <Card>
        <CardHeader><CardTitle>All Tournaments ({tournaments.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Tenant</TableHead>
                <TableHead>Format</TableHead><TableHead>Status</TableHead>
                <TableHead>Teams</TableHead><TableHead>Matches</TableHead>
                <TableHead>Dates</TableHead><TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tournaments.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.tenants?.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{t.format?.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status] ?? "outline"} className="capitalize">{t.status}</Badge>
                  </TableCell>
                  <TableCell>{t.teams?.[0]?.count || 0} / {t.max_teams || "∞"}</TableCell>
                  <TableCell>{t.matches?.[0]?.count || 0}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t.start_date && new Date(t.start_date).toLocaleDateString()}
                    {t.end_date && ` – ${new Date(t.end_date).toLocaleDateString()}`}
                  </TableCell>
                  <TableCell>
                    <Link href={`/tournaments/${t.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </TableCell>
                </TableRow>
              ))}
              {tournaments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No tournaments found. Create your first tournament to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
