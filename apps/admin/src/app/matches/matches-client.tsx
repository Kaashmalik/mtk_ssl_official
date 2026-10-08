"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
} from "@mtk/ui";

interface Match {
  id: string;
  match_number: number;
  match_type: string;
  status: string;
  scheduled_date: string;
  tournaments: { name: string };
  team_a: { name: string; logo_url: string };
  team_b: { name: string; logo_url: string };
  venue: { name: string; city: string };
  match_innings: { innings_number: number; total_runs: number; total_wickets: number }[];
}

const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  scheduled: "secondary",
  live: "default",
  completed: "outline",
  abandoned: "destructive",
  cancelled: "destructive",
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  group: "Group",
  knockout: "Knockout",
  quarter_final: "Quarter Final",
  semi_final: "Semi Final",
  final: "Final",
};

export function MatchesClient() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => setMatches(d.matches || []))
      .catch(() => setError("Failed to load matches"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardContent className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Matches</h1>
          <p className="text-muted-foreground mt-2">Schedule and manage cricket matches.</p>
        </div>
        <Link href="/matches/new">
          <Button>Schedule Match</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Matches ({matches.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match</TableHead>
                <TableHead>Tournament</TableHead>
                <TableHead>Teams</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((match) => (
                <TableRow key={match.id}>
                  <TableCell>
                    <div className="font-medium">Match #{match.match_number}</div>
                    <div className="text-xs text-muted-foreground">{match.id.slice(0, 8)}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {match.tournaments?.name || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      {match.team_a?.logo_url && (
                        <img src={match.team_a.logo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                      )}
                      <span>{match.team_a?.name}</span>
                      <span className="text-muted-foreground">vs</span>
                      <span>{match.team_b?.name}</span>
                      {match.team_b?.logo_url && (
                        <img src={match.team_b.logo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {MATCH_TYPE_LABELS[match.match_type] ?? match.match_type?.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[match.status] ?? "outline"} className="capitalize">
                      {match.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {match.match_innings?.length > 0 ? (
                      <div className="text-sm space-y-0.5">
                        {match.match_innings.map((inn, idx) => (
                          <div key={idx}>{inn.total_runs}/{inn.total_wickets}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {match.venue?.name || "-"}{match.venue?.city ? `, ${match.venue.city}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {match.scheduled_date ? new Date(match.scheduled_date).toLocaleString() : "-"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/matches/${match.id}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {matches.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No matches found. Schedule your first match to get started.
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
