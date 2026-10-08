"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";

interface Tenant { id: string; name: string }
interface Tournament { id: string; name: string }
interface Team { id: string; name: string }
interface Venue { id: string; name: string }

export function NewMatchForm() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenant_id: "", tournament_id: "", team_a_id: "", team_b_id: "",
    venue_id: "", match_number: "", match_type: "group", scheduled_date: "",
  });

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || [])).catch(() => toast.error("Failed to load tenants"));
  }, []);

  useEffect(() => {
    if (!formData.tenant_id) return;
    const id = formData.tenant_id;
    Promise.all([
      fetch(`/api/tournaments?tenantId=${id}`).then((r) => r.json()).then((d) => setTournaments(d.tournaments || [])),
      fetch(`/api/teams?tenantId=${id}`).then((r) => r.json()).then((d) => setTeams(d.teams || [])),
      fetch(`/api/venues?tenantId=${id}`).then((r) => r.json()).then((d) => setVenues(d.venues || [])),
    ]).catch(() => {});
  }, [formData.tenant_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formData.team_a_id === formData.team_b_id) { toast.error("Team A and Team B cannot be the same"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, match_number: formData.match_number ? parseInt(formData.match_number) : null }),
      });
      if (res.ok) { toast.success("Match scheduled successfully"); router.push("/matches"); }
      else { const err = await res.json(); toast.error(err.error || "Failed to schedule match"); }
    } catch { toast.error("Failed to schedule match"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild><Link href="/matches"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedule Match</h1>
          <p className="text-muted-foreground mt-1">Create a new cricket match between two teams.</p>
        </div>
      </div>
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>Match Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Organization *</Label>
              <Select value={formData.tenant_id} onValueChange={(v) => setFormData({ ...formData, tenant_id: v, tournament_id: "", team_a_id: "", team_b_id: "", venue_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Select an organization" /></SelectTrigger>
                <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tournament</Label>
              <Select value={formData.tournament_id} onValueChange={(v) => setFormData({ ...formData, tournament_id: v })} disabled={!formData.tenant_id}>
                <SelectTrigger><SelectValue placeholder="Select a tournament (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {tournaments.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Team A *</Label>
                <Select value={formData.team_a_id} onValueChange={(v) => setFormData({ ...formData, team_a_id: v })} disabled={!formData.tenant_id}>
                  <SelectTrigger><SelectValue placeholder="Select Team A" /></SelectTrigger>
                  <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Team B *</Label>
                <Select value={formData.team_b_id} onValueChange={(v) => setFormData({ ...formData, team_b_id: v })} disabled={!formData.tenant_id}>
                  <SelectTrigger><SelectValue placeholder="Select Team B" /></SelectTrigger>
                  <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Venue</Label>
              <Select value={formData.venue_id} onValueChange={(v) => setFormData({ ...formData, venue_id: v })} disabled={!formData.tenant_id}>
                <SelectTrigger><SelectValue placeholder="Select a venue (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {venues.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Match Type *</Label>
                <Select value={formData.match_type} onValueChange={(v) => setFormData({ ...formData, match_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">Group Stage</SelectItem>
                    <SelectItem value="knockout">Knockout</SelectItem>
                    <SelectItem value="quarter_final">Quarter Final</SelectItem>
                    <SelectItem value="semi_final">Semi Final</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Match Number</Label>
                <Input type="number" min={1} value={formData.match_number} onChange={(e) => setFormData({ ...formData, match_number: e.target.value })} placeholder="1" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Scheduled Date & Time *</Label>
              <Input type="datetime-local" value={formData.scheduled_date} onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} required />
            </div>
            <div className="flex gap-4 pt-4 border-t">
              <Button type="button" variant="outline" asChild><Link href="/matches">Cancel</Link></Button>
              <Button type="submit" disabled={loading || !formData.tenant_id || !formData.team_a_id || !formData.team_b_id || !formData.scheduled_date}>
                {loading ? "Scheduling..." : "Schedule Match"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
