"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@mtk/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui";
import { Input } from "@mtk/ui";
import { Label } from "@mtk/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select";
import { CheckCircle2, XCircle, Loader2, Globe, Mail, Smartphone, Palette } from "lucide-react";
// Simple toast implementation
const toast = {
  success: (message: string) => {
    if (typeof window !== "undefined") {
      alert(message);
    }
  },
  error: (message: string) => {
    if (typeof window !== "undefined") {
      alert(message);
    }
  }
};

const brandingSchema = z.object({
  // Basic Branding
  logoUrl: z.string().url().optional().or(z.literal("")),
  faviconUrl: z.string().url().optional().or(z.literal("")),
  appName: z.string().min(1, "App name is required"),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color"),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color"),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color"),
  fontFamily: z.string().optional(),
  hideSslBranding: z.boolean().optional(),

  // Custom Domain
  customDomain: z.string().optional(),
  
  // Email Settings
  emailSenderName: z.string().optional(),
  emailSenderAddress: z.string().email().optional().or(z.literal("")),

  // Mobile App
  mobileAppIconUrl: z.string().url().optional().or(z.literal("")),
  mobileAppSplashUrl: z.string().url().optional().or(z.literal("")),
  mobileAppBundleId: z.string().optional(),
  mobileAppPackageName: z.string().optional(),
});

type BrandingFormData = z.infer<typeof brandingSchema>;

interface VerificationStatus {
  status: "pending" | "verified" | "failed";
  verificationType?: string;
  expectedValue?: string;
  spfRecord?: string;
  dmarcRecord?: string;
  dkimPublicKey?: string;
  dkimSelector?: string;
  domain?: string;
}

interface LeagueOption {
  id: string;
  name: string;
  slug: string;
  plan: string;
  customDomain?: string | null;
}

export function BrandingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dnsVerification, setDnsVerification] = useState<VerificationStatus | null>(null);
  const [emailVerification, setEmailVerification] = useState<VerificationStatus | null>(null);
  const [sslStatus, setSslStatus] = useState<{ status: string } | null>(null);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  const form = useForm<BrandingFormData>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      appName: "",
      primaryColor: "#16a34a",
      secondaryColor: "#15803d",
      accentColor: "#22c55e",
      hideSslBranding: false,
    },
  });

  useEffect(() => {
    loadLeagues();
  }, []);

  useEffect(() => {
    if (!selectedLeagueId) return;
    setDnsVerification(null);
    setEmailVerification(null);
    setSslStatus(null);
    loadBrandingSettings(selectedLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeagueId]);

  async function loadLeagues() {
    try {
      const response = await fetch("/api/admin/leagues");
      if (!response.ok) throw new Error("Failed to load leagues");
      const data = await response.json();
      const list = data.leagues || [];
      setLeagues(list);
      if (list.length > 0) {
        setSelectedLeagueId(list[0].id);
      }
    } catch (error) {
      console.error("Failed to load leagues:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadBrandingSettings(tenantId: string) {
    try {
      const response = await fetch(`/api/settings/branding?tenantId=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        form.reset(data);
        
        // Load verification statuses
        if (data.customDomain) {
          loadDnsVerification(tenantId, data.customDomain);
          loadSslStatus(tenantId, data.customDomain);
        }
        if (data.emailSenderAddress) {
          loadEmailVerification(tenantId, data.emailSenderAddress);
        }
      }
    } catch (error) {
      console.error("Failed to load branding settings:", error);
    }
  }

  async function loadDnsVerification(tenantId: string, domain: string) {
    try {
      const response = await fetch(`/api/dns/verify?domain=${domain}&tenantId=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        setDnsVerification(data);
      }
    } catch (error) {
      console.error("Failed to load DNS verification:", error);
    }
  }

  async function loadSslStatus(tenantId: string, domain: string) {
    try {
      const response = await fetch(`/api/ssl/status?domain=${domain}&tenantId=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        setSslStatus(data);
      }
    } catch (error) {
      console.error("Failed to load SSL status:", error);
    }
  }

  async function loadEmailVerification(tenantId: string, email: string) {
    try {
      const domain = email.split("@")[1];
      const response = await fetch(`/api/email/verify?domain=${domain}&tenantId=${tenantId}`);
      if (response.ok) {
        const data = await response.json();
        setEmailVerification(data);
      }
    } catch (error) {
      console.error("Failed to load email verification:", error);
    }
  }

  async function onSubmit(data: BrandingFormData) {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, tenantId: selectedLeagueId }),
      });

      if (!response.ok) {
        throw new Error("Failed to save branding settings");
      }

      toast.success("Branding settings saved successfully");
      
      // Reload verification statuses if domain/email changed
      if (data.customDomain) {
        loadDnsVerification(selectedLeagueId, data.customDomain);
        loadSslStatus(selectedLeagueId, data.customDomain);
      }
      if (data.emailSenderAddress) {
        loadEmailVerification(selectedLeagueId, data.emailSenderAddress);
      }
    } catch (error) {
      toast.error("Failed to save branding settings");
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  async function initiateDnsVerification(domain: string) {
    try {
      const response = await fetch("/api/dns/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, tenantId: selectedLeagueId }),
      });

      if (!response.ok) {
        throw new Error("Failed to initiate DNS verification");
      }

      const data = await response.json();
      setDnsVerification(data);
      toast.success("DNS verification initiated. Please add the DNS record.");
    } catch (error) {
      toast.error("Failed to initiate DNS verification");
      console.error(error);
    }
  }

  async function initiateEmailVerification(email: string) {
    try {
      const domain = email.split("@")[1];
      const response = await fetch("/api/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, senderEmail: email, tenantId: selectedLeagueId }),
      });

      if (!response.ok) {
        throw new Error("Failed to initiate email verification");
      }

      const data = await response.json();
      setEmailVerification(data);
      toast.success("Email verification initiated. Please add the DNS records.");
    } catch (error) {
      toast.error("Failed to initiate email verification");
      console.error(error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!selectedLeagueId) {
    return (
      <div className="rounded-2xl border border-border/40 bg-muted/20 p-6">
        <h2 className="text-lg font-semibold">No leagues found</h2>
        <p className="text-sm text-muted-foreground mt-2">Create a league first to configure branding.</p>
      </div>
    );
  }

  const customDomain = form.watch("customDomain");
  const emailSenderAddress = form.watch("emailSenderAddress");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Select league</CardTitle>
          <CardDescription>All branding and system requirements are managed by super admin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedLeagueId} onValueChange={setSelectedLeagueId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Select a league" />
            </SelectTrigger>
            <SelectContent>
              {leagues.map((league) => (
                <SelectItem key={league.id} value={league.id}>
                  {league.name} • {league.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Tabs defaultValue="branding" className="space-y-6">
        <TabsList>
          <TabsTrigger value="branding">
            <Palette className="h-4 w-4 mr-2" />
            Branding
          </TabsTrigger>
          <TabsTrigger value="domain">
            <Globe className="h-4 w-4 mr-2" />
            Custom Domain
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="h-4 w-4 mr-2" />
            Email
          </TabsTrigger>
          <TabsTrigger value="mobile">
            <Smartphone className="h-4 w-4 mr-2" />
            Mobile App
          </TabsTrigger>
        </TabsList>

        {/* Branding Tab */}
        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Visual Branding</CardTitle>
              <CardDescription>
                Customize your league&apos;s logo, colors, and appearance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appName">App Name</Label>
                <Input
                  id="appName"
                  {...form.register("appName")}
                  placeholder="My Cricket League"
                />
                {form.formState.errors.appName && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.appName.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="logoUrl">Logo URL</Label>
                  <Input
                    id="logoUrl"
                    {...form.register("logoUrl")}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="faviconUrl">Favicon URL</Label>
                  <Input
                    id="faviconUrl"
                    {...form.register("faviconUrl")}
                    placeholder="https://example.com/favicon.ico"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="primaryColor"
                      {...form.register("primaryColor")}
                      type="color"
                      className="w-16 h-10"
                    />
                    <Input
                      {...form.register("primaryColor")}
                      placeholder="#16a34a"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondaryColor">Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="secondaryColor"
                      {...form.register("secondaryColor")}
                      type="color"
                      className="w-16 h-10"
                    />
                    <Input
                      {...form.register("secondaryColor")}
                      placeholder="#15803d"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accentColor">Accent Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="accentColor"
                      {...form.register("accentColor")}
                      type="color"
                      className="w-16 h-10"
                    />
                    <Input
                      {...form.register("accentColor")}
                      placeholder="#22c55e"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fontFamily">Font Family</Label>
                <Input
                  id="fontFamily"
                  {...form.register("fontFamily")}
                  placeholder="Inter, sans-serif"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="hideSslBranding"
                  {...form.register("hideSslBranding")}
                  className="rounded"
                />
                <Label htmlFor="hideSslBranding">
                  Hide &quot;Powered by SSL&quot; branding (Enterprise only)
                </Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Custom Domain Tab */}
        <TabsContent value="domain" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Custom Domain</CardTitle>
              <CardDescription>
                Connect your custom domain (e.g., myleague.com) to your league
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customDomain">Domain</Label>
                <Input
                  id="customDomain"
                  {...form.register("customDomain")}
                  placeholder="myleague.com"
                />
                <p className="text-sm text-muted-foreground">
                  Enter your domain without www or http://
                </p>
              </div>

              {customDomain && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">DNS Verification</h4>
                      <p className="text-sm text-muted-foreground">
                        Verify domain ownership
                      </p>
                    </div>
                    {dnsVerification?.status === "verified" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : dnsVerification?.status === "failed" ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {dnsVerification && dnsVerification.status === "pending" && (
                    <div className="space-y-2 p-3 bg-muted rounded">
                      <p className="text-sm font-mono">
                        Add this TXT record to your DNS:
                      </p>
                      <p className="text-sm font-mono">
                        <strong>Name:</strong> {dnsVerification.verificationType === "txt" ? "_ssl-verify" : "@"}
                      </p>
                      <p className="text-sm font-mono">
                        <strong>Value:</strong> {dnsVerification.expectedValue}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => loadDnsVerification(selectedLeagueId, customDomain)}
                      >
                        Check Verification
                      </Button>
                    </div>
                  )}

                  {!dnsVerification && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => initiateDnsVerification(customDomain)}
                    >
                      Start DNS Verification
                    </Button>
                  )}

                  {dnsVerification?.status === "verified" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">SSL Certificate</h4>
                          <p className="text-sm text-muted-foreground">
                            Automatic SSL via Let&apos;s Encrypt
                          </p>
                        </div>
                        {sslStatus?.status === "active" ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Settings</CardTitle>
              <CardDescription>
                Configure custom email sender for your league
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="emailSenderName">Sender Name</Label>
                <Input
                  id="emailSenderName"
                  {...form.register("emailSenderName")}
                  placeholder="My Cricket League"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="emailSenderAddress">Sender Email</Label>
                <Input
                  id="emailSenderAddress"
                  {...form.register("emailSenderAddress")}
                  type="email"
                  placeholder="no-reply@myleague.com"
                />
              </div>

              {emailSenderAddress && (
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Email Domain Verification</h4>
                      <p className="text-sm text-muted-foreground">
                        DKIM/SPF records
                      </p>
                    </div>
                    {emailVerification?.status === "verified" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : emailVerification?.status === "failed" ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {emailVerification && emailVerification.status === "pending" && (
                    <div className="space-y-3 p-3 bg-muted rounded">
                      <div>
                        <p className="text-sm font-medium mb-2">Add these DNS records:</p>
                        {emailVerification.spfRecord && (
                          <div className="mb-2">
                            <p className="text-xs font-mono text-muted-foreground">SPF (TXT on root domain):</p>
                            <p className="text-sm font-mono break-all">{emailVerification.spfRecord}</p>
                          </div>
                        )}
                        {emailVerification.dmarcRecord && (
                          <div className="mb-2">
                            <p className="text-xs font-mono text-muted-foreground">
                              DMARC (TXT on _dmarc.{emailVerification.domain || "yourdomain"}):
                            </p>
                            <p className="text-sm font-mono break-all">{emailVerification.dmarcRecord}</p>
                          </div>
                        )}
                        {emailVerification.dkimPublicKey && (
                          <div>
                            <p className="text-xs font-mono text-muted-foreground">
                              DKIM (TXT on {emailVerification.dkimSelector}._domainkey):
                            </p>
                            <p className="text-sm font-mono break-all">{emailVerification.dkimPublicKey}</p>
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => loadEmailVerification(selectedLeagueId, emailSenderAddress)}
                      >
                        Check Verification
                      </Button>
                    </div>
                  )}

                  {!emailVerification && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => initiateEmailVerification(emailSenderAddress)}
                    >
                      Start Email Verification
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mobile App Tab */}
        <TabsContent value="mobile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mobile App Branding</CardTitle>
              <CardDescription>
                Customize your mobile app appearance (Enterprise only)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mobileAppIconUrl">App Icon URL</Label>
                  <Input
                    id="mobileAppIconUrl"
                    {...form.register("mobileAppIconUrl")}
                    placeholder="https://example.com/icon.png"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mobileAppSplashUrl">Splash Screen URL</Label>
                  <Input
                    id="mobileAppSplashUrl"
                    {...form.register("mobileAppSplashUrl")}
                    placeholder="https://example.com/splash.png"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mobileAppBundleId">iOS Bundle ID</Label>
                  <Input
                    id="mobileAppBundleId"
                    {...form.register("mobileAppBundleId")}
                    placeholder="com.myleague.app"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mobileAppPackageName">Android Package Name</Label>
                  <Input
                    id="mobileAppPackageName"
                    {...form.register("mobileAppPackageName")}
                    placeholder="com.myleague.app"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={() => form.reset()}>
          Reset
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </form>
  );
}

