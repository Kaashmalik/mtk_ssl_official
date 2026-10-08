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

interface Player {
  id: string;
  jersey_number: number;
  role: string;
  batting_style: string;
  bowling_style: string;
  is_active: boolean;
  teams: { name: string; logo_url: string };
  profiles: { first_name: string; last_name: string; display_name: string; avatar_url: string };
  users: { email: string };
}

const ROLE_LABELS: Record<string, string> = {
  batsman: "Batsman", bowler: "Bowler", all_rounder: "All-Rounder",
  wicket_keeper: "WK", wicket_keeper_batsman: "WK/Bat",
};

export function PlayersClient() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((d) => setPlayers(d.players || []))
      .catch(() => toast.error("Failed to load players"))
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
          <h1 className="text-3xl font-bold tracking-tight">Players</h1>
          <p className="text-muted-foreground mt-2">Manage cricket players across all teams.</p>
        </div>
        <Link href="/players/new"><Button>Create Player</Button></Link>
      </div>
      <Card>
        <CardHeader><CardTitle>All Players ({players.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead><TableHead>Team</TableHead>
                <TableHead>Role</TableHead><TableHead>Jersey #</TableHead>
                <TableHead>Batting</TableHead><TableHead>Bowling</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
                <TableRow key={player.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {player.profiles?.avatar_url && (
                        <img src={player.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      )}
                      <div>
                        <div className="font-medium">
                          {player.profiles?.display_name ||
                            `${player.profiles?.first_name || ""} ${player.profiles?.last_name || ""}`.trim() ||
                            player.users?.email || "Unnamed"}
                        </div>
                        {player.users?.email && (
                          <div className="text-xs text-muted-foreground">{player.users.email}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {player.teams?.logo_url && (
                        <img src={player.teams.logo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                      )}
                      <span className="text-muted-foreground">{player.teams?.name || "-"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABELS[player.role] || player.role}</Badge>
                  </TableCell>
                  <TableCell>{player.jersey_number || "-"}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{player.batting_style || "-"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {player.bowling_style?.replace(/_/g, " ") || "-"}
                  </TableCell>
                  <TableCell>
                    {player.is_active
                      ? <Badge className="bg-green-500">Active</Badge>
                      : <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/players/${player.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </TableCell>
                </TableRow>
              ))}
              {players.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No players found. Create your first player to get started.
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
