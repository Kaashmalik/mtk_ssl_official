"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Input, Label, Textarea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";
import { CloudinaryUpload } from "@/components/ui/cloudinary-upload";

interface Tenant { id: string; name: string }

export function NewTournamentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTenant = searchParams.get("tenantId");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenant_id: preselectedTenant || "", name: "", slug: "", description: "",
    format: "league", start_date: "", end_date: "", max_teams: "", registration_deadline: "",
    logo_url: "", banner_url: "",
  });

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || [])).catch(() => toast.error("Failed to load tenants"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, max_teams: formData.max_teams ? parseInt(formData.max_teams) : null }),
      });
      if (res.ok) { toast.success("Tournament created successfully"); router.push("/tournaments"); }
      else { const err = await res.json(); toast.error(err.error || "Failed to create tournament"); }
    } catch { toast.error("Failed to create tournament"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild><Link href="/tournaments"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Tournament</h1>
          <p className="text-muted-foreground mt-1">Set up a new cricket tournament.</p>
        </div>
      </div>
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>Tournament Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Organization *</Label>
              <Select value={formData.tenant_id} onValueChange={(v) => setFormData({ ...formData, tenant_id: v })} disabled={!!preselectedTenant}>
                <SelectTrigger><SelectValue placeholder="Select an organization" /></SelectTrigger>
                <SelectContent>{tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tournament Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Shakir Super League 2026" required />
            </div>
            <div className="space-y-2">
              <Label>URL Slug *</Label>
              <Input value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="shakir-super-league-2026" required />
              <p className="text-xs text-muted-foreground">Used in URLs: /tournaments/{formData.slug || "example"}</p>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Tournament description..." rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Tournament Format *</Label>
              <Select value={formData.format} onValueChange={(v) => setFormData({ ...formData, format: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="league">League (Round Robin)</SelectItem>
                  <SelectItem value="knockout">Knockout</SelectItem>
                  <SelectItem value="hybrid">Hybrid (League + Knockout)</SelectItem>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Maximum Teams</Label>
                <Input type="number" min={2} max={32} value={formData.max_teams} onChange={(e) => setFormData({ ...formData, max_teams: e.target.value })} placeholder="16" />
              </div>
              <div className="space-y-2">
                <Label>Registration Deadline</Label>
                <Input type="date" value={formData.registration_deadline} onChange={(e) => setFormData({ ...formData, registration_deadline: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tournament Logo</Label>
                <CloudinaryUpload
                  value={formData.logo_url}
                  onChange={(url) => setFormData({ ...formData, logo_url: url })}
                  onClear={() => setFormData({ ...formData, logo_url: "" })}
                  folder="ssl-admin/tournaments/logos"
                  label="Upload tournament logo"
                  accept="image"
                  aspectRatio="aspect-square"
                />
              </div>
              <div className="space-y-2">
                <Label>Tournament Banner</Label>
                <CloudinaryUpload
                  value={formData.banner_url}
                  onChange={(url) => setFormData({ ...formData, banner_url: url })}
                  onClear={() => setFormData({ ...formData, banner_url: "" })}
                  folder="ssl-admin/tournaments/banners"
                  label="Upload banner image"
                  accept="image"
                  aspectRatio="aspect-video"
                />
              </div>
            </div>
            <div className="flex gap-4 pt-4 border-t">
              <Button type="button" variant="outline" asChild><Link href="/tournaments">Cancel</Link></Button>
              <Button type="submit" disabled={loading || !formData.tenant_id}>{loading ? "Creating..." : "Create Tournament"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
