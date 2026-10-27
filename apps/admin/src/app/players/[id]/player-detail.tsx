"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@mtk/ui";

interface PlayerDetailRow {
  id: string;
  tenant_id: string;
  team_id: string | null;
  name: string;
  photo_url: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  city: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  jersey_number: number | null;
  role: string | null;
  batting_style: string | null;
  bowling_style: string | null;
  biography: string | null;
  status: string | null;
  is_active: boolean;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  guardian_consent_at: string | null;
  teams: { name: string | null; logo_url: string | null } | null;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  users: { email: string | null } | null;
}

const ROLE_LABELS: Record<string, string> = {
  batsman: "Batsman",
  bowler: "Bowler",
  all_rounder: "All-Rounder",
  wicket_keeper: "Wicket Keeper",
  wicket_keeper_batsman: "Wicket Keeper / Batsman",
};

const BOWLING_LABELS: Record<string, string> = {
  right_arm_fast: "Right arm fast",
  right_arm_medium: "Right arm medium",
  right_arm_spin: "Right arm spin",
  left_arm_fast: "Left arm fast",
  left_arm_medium: "Left arm medium",
  left_arm_spin: "Left arm spin",
};

function humanize(value: string | null, labels: Record<string, string> = {}) {
  if (!value) return "-";
  return labels[value] ?? value.replace(/_/g, " ");
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

export function PlayerDetail({ playerId }: { playerId: string }) {
  const [player, setPlayer] = useState<PlayerDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/players/${playerId}`)
      .then(async (res) => {
        if (res.status === 404) {
          setMissing(true);
          return null;
        }
        if (!res.ok) throw new Error("Failed to load player");
        return res.json();
      })
      .then((data) => {
        if (data?.player) setPlayer(data.player as PlayerDetailRow);
      })
      .catch(() => toast.error("Failed to load player"))
      .finally(() => setLoading(false));
  }, [playerId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardContent className="p-6 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (missing || !player) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/players">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to players
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            This player does not exist or is no longer available.
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName =
    player.profiles?.display_name ||
    `${player.profiles?.first_name ?? ""} ${player.profiles?.last_name ?? ""}`.trim() ||
    player.name;
  const avatar = player.profiles?.avatar_url ?? player.photo_url;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild>
          <Link href="/players">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
          <p className="text-muted-foreground mt-1">
            {player.teams?.name ?? "No team assigned"} · {humanize(player.role, ROLE_LABELS)}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-muted" aria-hidden />
          )}
          <div>
            <CardTitle>{displayName}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{humanize(player.role, ROLE_LABELS)}</Badge>
              <Badge variant="outline">{humanize(player.status)}</Badge>
              {player.is_active ? (
                <Badge className="bg-green-500">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Team" value={player.teams?.name ?? "-"} />
            <Field label="Jersey number" value={player.jersey_number ?? "-"} />
            <Field label="Batting style" value={humanize(player.batting_style)} />
            <Field label="Bowling style" value={humanize(player.bowling_style, BOWLING_LABELS)} />
            <Field label="Date of birth" value={player.date_of_birth ?? "-"} />
            <Field label="Joined" value={player.joined_at ?? "-"} />
            <Field label="Nationality" value={player.nationality ?? "-"} />
            <Field label="City" value={player.city ?? "-"} />
            <Field label="Phone" value={player.phone ?? "-"} />
            <Field label="Account email" value={player.email ?? player.users?.email ?? "-"} />
            <Field
              label="Height / Weight"
              value={
                player.height_cm || player.weight_kg
                  ? `${player.height_cm ?? "-"} cm / ${player.weight_kg ?? "-"} kg`
                  : "-"
              }
            />
            <Field
              label="Guardian consent"
              value={
                player.guardian_consent_at
                  ? `Recorded ${new Date(player.guardian_consent_at).toLocaleDateString()}`
                  : "Not recorded"
              }
            />
            <Field label="League (tenant)" value={player.tenant_id} />
            <Field label="Player record" value={player.id} />
            <Field label="Updated" value={new Date(player.updated_at).toLocaleString()} />
          </dl>
          {player.biography && (
            <div className="mt-6 border-t pt-4">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Biography</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm">{player.biography}</dd>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Guardian consent is a league-recorded fact, not platform-verified identity. Minors appear on
        public surfaces only while consent is recorded.
      </p>
    </div>
  );
}
