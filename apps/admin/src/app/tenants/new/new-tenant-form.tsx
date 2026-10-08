"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@mtk/ui";
import { CloudinaryUpload } from "@/components/ui/cloudinary-upload";

export function NewTenantForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ name: "", slug: "", owner_id: "", plan: "free", logo_url: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        toast.success("Tenant created successfully");
        router.push("/tenants");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create tenant");
      }
    } catch {
      toast.error("Failed to create tenant");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Tenant</h1>
        <p className="text-muted-foreground mt-2">Add a new organization to the SSL platform.</p>
      </div>
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Tenant Information</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Shakir Super League" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="shakir-super-league" required />
              <p className="text-xs text-muted-foreground">Used in URLs: /t/{formData.slug || "example"}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner_id">Owner User ID</Label>
              <Input id="owner_id" value={formData.owner_id} onChange={(e) => setFormData({ ...formData, owner_id: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan">Plan</Label>
              <Select value={formData.plan} onValueChange={(v) => setFormData({ ...formData, plan: v })}>
                <SelectTrigger id="plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Organization Logo</Label>
              <CloudinaryUpload
                value={formData.logo_url}
                onChange={(url) => setFormData({ ...formData, logo_url: url })}
                onClear={() => setFormData({ ...formData, logo_url: "" })}
                folder="ssl-admin/tenants"
                label="Upload organization logo"
                accept="image"
                aspectRatio="aspect-square"
              />
            </div>
            <div className="flex gap-4 pt-4">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create Tenant"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
