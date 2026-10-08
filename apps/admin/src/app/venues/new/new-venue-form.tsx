"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, MapPin } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";
import { CloudinaryUpload } from "@/components/ui/cloudinary-upload";

interface Tenant { id: string; name: string }

export function NewVenueForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTenant = searchParams.get("tenantId");

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    tenant_id: preselectedTenant || "", name: "", address: "",
    city: "", state: "", country: "", capacity: "", ground_type: "grass", image_url: "",
  });

  useEffect(() => {
    fetch("/api/tenants").then((r) => r.json()).then((d) => setTenants(d.tenants || [])).catch(() => toast.error("Failed to load tenants"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, capacity: formData.capacity ? parseInt(formData.capacity) : null }),
      });
      if (res.ok) { toast.success("Venue created successfully"); router.push("/venues"); }
      else { const err = await res.json(); toast.error(err.error || "Failed to create venue"); }
    } catch { toast.error("Failed to create venue"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" asChild><Link href="/venues"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link></Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Venue</h1>
          <p className="text-muted-foreground mt-1">Register a new cricket ground or stadium.</p>
        </div>
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" />Venue Details</CardTitle>
        </CardHeader>
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
              <Label>Venue Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="National Stadium Karachi" required />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Full street address" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Karachi" />
              </div>
              <div className="space-y-2">
                <Label>State/Province</Label>
                <Input value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} placeholder="Sindh" />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })} placeholder="Pakistan" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacity</Label>
                <Input type="number" min={0} value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} placeholder="30000" />
              </div>
              <div className="space-y-2">
                <Label>Ground Type</Label>
                <Select value={formData.ground_type} onValueChange={(v) => setFormData({ ...formData, ground_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grass">Natural Grass</SelectItem>
                    <SelectItem value="synthetic">Synthetic</SelectItem>
                    <SelectItem value="concrete">Concrete</SelectItem>
                    <SelectItem value="matting">Matting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Venue Photo</Label>
              <CloudinaryUpload
                value={formData.image_url}
                onChange={(url) => setFormData({ ...formData, image_url: url })}
                onClear={() => setFormData({ ...formData, image_url: "" })}
                folder="ssl-admin/venues"
                label="Upload venue photo"
                accept="image"
                aspectRatio="aspect-video"
              />
            </div>
            <div className="flex gap-4 pt-4 border-t">
              <Button type="button" variant="outline" asChild><Link href="/venues">Cancel</Link></Button>
              <Button type="submit" disabled={loading || !formData.tenant_id}>{loading ? "Creating..." : "Add Venue"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
