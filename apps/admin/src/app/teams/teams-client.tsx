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

interface Team {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  home_ground: string;
  is_active: boolean;
  tenants: { name: string };
  tournaments: { name: string };
  players: { count: number }[];
}

export function TeamsClient() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/teams")
      .then((r) => r.json())
      .then((d) => setTeams(d.teams || []))
      .catch(() => toast.error("Failed to load teams"))
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
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground mt-2">Manage cricket teams across all tournaments.</p>
        </div>
        <Link href="/teams/new"><Button>Create Team</Button></Link>
      </div>
      <Card>
        <CardHeader><CardTitle>All Teams ({teams.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead><TableHead>Tenant</TableHead>
                <TableHead>Tournament</TableHead><TableHead>Status</TableHead>
                <TableHead>Players</TableHead><TableHead>Home Ground</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {team.logo_url && (
                        <img src={team.logo_url} alt={team.name} className="w-8 h-8 rounded-full object-cover" />
                      )}
                      <div>
                        <div className="font-medium">{team.name}</div>
                        <div className="text-xs text-muted-foreground">{team.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{team.tenants?.name}</TableCell>
                  <TableCell className="text-muted-foreground">{team.tournaments?.name || "-"}</TableCell>
                  <TableCell>
                    {team.is_active
                      ? <Badge className="bg-green-500">Active</Badge>
                      : <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell>{team.players?.[0]?.count || 0}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{team.home_ground || "-"}</TableCell>
                  <TableCell>
                    <Link href={`/teams/${team.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No teams found. Create your first team to get started.
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
