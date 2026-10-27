"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mtk/ui";

interface Tenant { id: string; name: string }
interface Team { id: string; name: string }

const ROLES = [
  { value: "batsman", label: "Batsman" },
  { value: "bowler", label: "Bowler" },
  { value: "all_rounder", label: "All-Rounder" },
  { value: "wicket_keeper", label: "Wicket Keeper" },
  { value: "wicket_keeper_batsman", label: "Wicket Keeper / Batsman" },
];

const BATTING_STYLES = [
  { value: "right", label: "Right handed" },
  { value: "left", label: "Left handed" },
];

const BOWLING_STYLES = [
  { value: "right_arm_fast", label: "Right arm fast" },
  { value: "right_arm_medium", label: "Right arm medium" },
  { value: "right_arm_spin", label: "Right arm spin" },
  { value: "left_arm_fast", label: "Left arm fast" },
  { value: "left_arm_medium", label: "Left arm medium" },
  { value: "left_arm_spin", label: "Left arm spin" },
];

export function NewPlayerForm() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenant_id: "",
    team_id: "",
    name: "",
    role: "",
    jersey_number: "",
    batting_style: "",
    bowling_style: "",
  });

  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((d) => setTenants(d.tenants || []))
      .catch(() => toast.error("Failed to load leagues"));
  }, []);

  useEffect(() => {
    if (!formData.tenant_id) {
      setTeams([]);
      return;
    }
    const id = formData.tenant_id;
    fetch(`/api/teams?tenantId=${id}`)
      .then((r) => r.json())
      .then((d) => setTeams(d.teams || []))
      .catch(() => toast.error("Failed to load teams"));
  }, [formData.tenant_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.tenant_id || !formData.name.trim() || !formData.role) {
      toast.error("League, player name and role are required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: formData.tenant_id,
          team_id: formData.team_id || undefined,
          name: formData.name.trim(),
          role: formData.role,
          jersey_number: formData.jersey_number || undefined,
          batting_style: formData.batting_style || undefined,
          bowling_style: formData.bowling_style || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success("Player created");
        router.push(data?.player?.id ? `/players/${data.player.id}` : "/players");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to create player");
      }
    } catch {
      toast.error("Failed to create player");
    } finally {
      setLoading(false);
    }
  }

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
          <h1 className="text-3xl font-bold tracking-tight">Create Player</h1>
          <p className="text-muted-foreground mt-1">
            Add a player record to a league. Team assignment is optional and can follow later.
          </p>
        </div>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Player Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>League *</Label>
              <Select
                value={formData.tenant_id}
                onValueChange={(v) =>
                  setFormData({ ...formData, tenant_id: v, team_id: "" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a league" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Team</Label>
              <Select
                value={formData.team_id}
                onValueChange={(v) => setFormData({ ...formData, team_id: v })}
                disabled={!formData.tenant_id || teams.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.tenant_id ? "Select a team (optional)" : "Select a league first"} />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Player name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Full name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Role *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(v) => setFormData({ ...formData, role: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Jersey number</Label>
                <Input
                  type="number"
                  min={0}
                  value={formData.jersey_number}
                  onChange={(e) => setFormData({ ...formData, jersey_number: e.target.value })}
                  placeholder="10"
                />
              </div>
              <div className="space-y-2">
                <Label>Batting style</Label>
                <Select
                  value={formData.batting_style}
                  onValueChange={(v) => setFormData({ ...formData, batting_style: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a style (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {BATTING_STYLES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bowling style</Label>
                <Select
                  value={formData.bowling_style}
                  onValueChange={(v) => setFormData({ ...formData, bowling_style: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a style (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {BOWLING_STYLES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4 border-t pt-4">
              <Button type="button" variant="outline" asChild>
                <Link href="/players">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={loading || !formData.tenant_id || !formData.name.trim() || !formData.role}
              >
                {loading ? "Creating..." : "Create Player"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
