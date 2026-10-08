"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";
import { CloudinaryUpload } from "@/components/ui/cloudinary-upload";

interface Tenant { id: string; name: string }
interface Tournament { id: string; name: string; tenant_id: string }

export function NewTeamForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTenant = searchParams.get("tenantId");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenant_id: preselectedTenant || "", tournament_id: "", name: "",
    slug: "", logo_url: "", jersey_color: "", home_ground: "",
  });

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || [])).catch(() => toast.error("Failed to load tenants"));
  }, []);

  useEffect(() => {
    if (formData.tenant_id) {
      fetch(`/api/tournaments?tenantId=${formData.tenant_id}`).then((r) => r.json()).then((d) => setTournaments(d.tournaments || [])).catch(() => {});
    }
  }, [formData.tenant_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData),
      });
      if (res.ok) { toast.success("Team created successfully"); router.push("/teams"); }
      else { const err = await res.json(); toast.error(err.error || "Failed to create team"); }
    } catch { toast.error("Failed to create team"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild><Link href="/teams"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Team</h1>
          <p className="text-muted-foreground mt-1">Add a new cricket team to a tournament.</p>
        </div>
      </div>
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>Team Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Organization *</Label>
              <Select value={formData.tenant_id} onValueChange={(v) => setFormData({ ...formData, tenant_id: v, tournament_id: "" })} disabled={!!preselectedTenant}>
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
            <div className="space-y-2">
              <Label>Team Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Karachi Kings" required />
            </div>
            <div className="space-y-2">
              <Label>URL Slug *</Label>
              <Input value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="karachi-kings" required />
            </div>
            <div className="space-y-2">
              <Label>Team Logo</Label>
              <CloudinaryUpload
                value={formData.logo_url}
                onChange={(url) => setFormData({ ...formData, logo_url: url })}
                onClear={() => setFormData({ ...formData, logo_url: "" })}
                folder="ssl-admin/teams"
                label="Upload team logo"
                accept="image"
                aspectRatio="aspect-square"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Jersey Color</Label>
                <Input value={formData.jersey_color} onChange={(e) => setFormData({ ...formData, jersey_color: e.target.value })} placeholder="#FF0000" />
              </div>
              <div className="space-y-2">
                <Label>Home Ground</Label>
                <Input value={formData.home_ground} onChange={(e) => setFormData({ ...formData, home_ground: e.target.value })} placeholder="National Stadium Karachi" />
              </div>
            </div>
            <div className="flex gap-4 pt-4 border-t">
              <Button type="button" variant="outline" asChild><Link href="/teams">Cancel</Link></Button>
              <Button type="submit" disabled={loading || !formData.tenant_id}>{loading ? "Creating..." : "Create Team"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
