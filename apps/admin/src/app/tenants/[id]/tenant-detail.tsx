"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Edit, Building2, Users, Trophy, Users2, MapPin } from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge, Skeleton,
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@mtk/ui";

interface Tenant {
  id: string; name: string; slug: string; custom_domain: string;
  plan: string; is_active: boolean; created_at: string;
  tenant_branding: { logo_url: string; primary_color: string; secondary_color: string; app_name: string; hide_ssl_branding: boolean }[];
  tournaments: { id: string; name: string; status: string }[];
  teams: { id: string; name: string }[];
  users: { id: string; email: string }[];
  venues: { id: string; name: string }[];
}

const PLAN_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  free: "secondary", pro: "default", enterprise: "destructive",
};

export function TenantDetail() {
  const params = useParams();
  const tenantId = params.id as string;
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((d) => setTenant(d.tenant))
      .catch(() => toast.error("Failed to load tenant details"))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild><Link href="/tenants"><ArrowLeft className="w-4 h-4 mr-2" />Back to Tenants</Link></Button>
        <Card className="p-12 text-center">
          <CardContent>
            <div className="text-6xl mb-4">🏢</div>
            <h3 className="text-xl font-semibold mb-2">Tenant Not Found</h3>
            <p className="text-muted-foreground">The tenant you&apos;re looking for doesn&apos;t exist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" asChild><Link href="/tenants"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link></Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tenant.name}</h1>
            <p className="text-muted-foreground flex items-center gap-2 flex-wrap">
              {tenant.slug}
              <Badge variant={PLAN_VARIANT[tenant.plan] ?? "outline"} className="capitalize">{tenant.plan}</Badge>
              {tenant.is_active
                ? <Badge className="bg-green-500">Active</Badge>
                : <Badge variant="secondary">Inactive</Badge>}
            </p>
          </div>
        </div>
        <Link href={`/tenants/${tenantId}/edit`}>
          <Button className="gap-2"><Edit className="w-4 h-4" />Edit Tenant</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Trophy, color: "blue", count: tenant.tournaments?.length || 0, label: "Tournaments" },
          { icon: Users2, color: "green", count: tenant.teams?.length || 0, label: "Teams" },
          { icon: Users, color: "purple", count: tenant.users?.length || 0, label: "Users" },
          { icon: MapPin, color: "orange", count: tenant.venues?.length || 0, label: "Venues" },
        ].map(({ icon: Icon, color, count, label }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-3 bg-${color}-100 dark:bg-${color}-950/40 rounded-lg`}>
                <Icon className={`w-5 h-5 text-${color}-600`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />Organization Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div>{new Date(tenant.created_at).toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Custom Domain</div>
                  <div>{tenant.custom_domain || "-"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tournaments">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Tournaments</CardTitle>
              <Link href={`/tournaments/new?tenantId=${tenantId}`}><Button size="sm">Create Tournament</Button></Link>
            </CardHeader>
            <CardContent>
              {!tenant.tournaments?.length ? (
                <div className="text-center py-8 text-muted-foreground">No tournaments yet.</div>
              ) : (
                <div className="space-y-2">
                  {tenant.tournaments.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50">
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <Badge variant="outline" className="mt-1 capitalize">{t.status}</Badge>
                      </div>
                      <Link href={`/tournaments/${t.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Teams</CardTitle>
              <Link href={`/teams/new?tenantId=${tenantId}`}><Button size="sm">Create Team</Button></Link>
            </CardHeader>
            <CardContent>
              {!tenant.teams?.length ? (
                <div className="text-center py-8 text-muted-foreground">No teams yet.</div>
              ) : (
                <div className="space-y-2">
                  {tenant.teams.map((team) => (
                    <div key={team.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50">
                      <div className="font-medium">{team.name}</div>
                      <Link href={`/teams/${team.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding">
          <Card>
            <CardHeader><CardTitle>White Label Configuration</CardTitle></CardHeader>
            <CardContent>
              {tenant.tenant_branding?.[0] ? (
                <div className="space-y-4">
                  {tenant.tenant_branding[0].logo_url && (
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">Logo</div>
                      <img src={tenant.tenant_branding[0].logo_url} alt="Logo" className="w-32 h-32 object-contain rounded-lg border" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Primary Color</div>
                      <div className="w-20 h-8 rounded border mt-1" style={{ backgroundColor: tenant.tenant_branding[0].primary_color || "#000" }} />
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Secondary Color</div>
                      <div className="w-20 h-8 rounded border mt-1" style={{ backgroundColor: tenant.tenant_branding[0].secondary_color || "#000" }} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">App Name</div>
                    <div>{tenant.tenant_branding[0].app_name || tenant.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Hide SSL Branding</div>
                    <Badge variant={tenant.tenant_branding[0].hide_ssl_branding ? "default" : "secondary"}>
                      {tenant.tenant_branding[0].hide_ssl_branding ? "Yes" : "No"}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No custom branding configured.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
