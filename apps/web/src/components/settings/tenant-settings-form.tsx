"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { toast } from "sonner"
import { Loader2, Settings } from "lucide-react"
import { updateTenantBrandingSettings } from "@/app/actions/tenants"

const settingsSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters").max(120),
  appName: z.string().min(2, "App name must be at least 2 characters").max(120).optional().nullable().or(z.literal("")),
  logoUrl: z.string().url("Invalid URL").optional().nullable().or(z.literal("")),
  faviconUrl: z.string().url("Invalid URL").optional().nullable().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable().or(z.literal("")),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable().or(z.literal("")),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable().or(z.literal("")),
})

type SettingsFormData = z.infer<typeof settingsSchema>

interface TenantSettingsFormProps {
  initialData: {
    name: string
    appName?: string | null
    logoUrl?: string | null
    faviconUrl?: string | null
    primaryColor?: string | null
    secondaryColor?: string | null
    accentColor?: string | null
  }
}

export function TenantSettingsForm({ initialData }: TenantSettingsFormProps) {
  const [saving, setSaving] = useState(false)

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: initialData.name,
      appName: initialData.appName || "",
      logoUrl: initialData.logoUrl || "",
      faviconUrl: initialData.faviconUrl || "",
      primaryColor: initialData.primaryColor || "#16a34a",
      secondaryColor: initialData.secondaryColor || "#15803d",
      accentColor: initialData.accentColor || "#22c55e",
    },
  })

  const onSubmit = async (data: SettingsFormData) => {
    setSaving(true)
    try {
      const res = await updateTenantBrandingSettings({
        name: data.name,
        appName: data.appName || null,
        logoUrl: data.logoUrl || null,
        faviconUrl: data.faviconUrl || null,
        primaryColor: data.primaryColor || null,
        secondaryColor: data.secondaryColor || null,
        accentColor: data.accentColor || null,
      })

      if (res.success) {
        toast.success("Settings saved successfully! Refreshing page branding...")
        window.location.reload()
      } else {
        toast.error("Failed to save settings")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const primaryColor = form.watch("primaryColor") || "#16a34a"

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" style={{ color: primaryColor }} />
            General League Settings
          </CardTitle>
          <CardDescription>
            Configure your league name and custom app details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* League name */}
          <div className="space-y-2">
            <Label htmlFor="name">League Name</Label>
            <Input id="name" {...form.register("name")} placeholder="My Cricket League" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          {/* App Display Name */}
          <div className="space-y-2">
            <Label htmlFor="appName">App Display Name (White-Label)</Label>
            <Input id="appName" {...form.register("appName")} placeholder="My white-labeled app name" />
            {form.formState.errors.appName && (
              <p className="text-xs text-destructive">{form.formState.errors.appName.message}</p>
            )}
          </div>

          {/* Logos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="logoUrl">Logo Image URL</Label>
              <Input id="logoUrl" {...form.register("logoUrl")} placeholder="https://example.com/logo.png" />
              {form.formState.errors.logoUrl && (
                <p className="text-xs text-destructive">{form.formState.errors.logoUrl.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="faviconUrl">Favicon URL</Label>
              <Input id="faviconUrl" {...form.register("faviconUrl")} placeholder="https://example.com/favicon.ico" />
              {form.formState.errors.faviconUrl && (
                <p className="text-xs text-destructive">{form.formState.errors.faviconUrl.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Colors Card */}
      <Card>
        <CardHeader>
          <CardTitle>Branding & Theme Colors</CardTitle>
          <CardDescription>
            Choose your brand colors to customize the application theme dashboard layout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Primary Color */}
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="primaryColor"
                  {...form.register("primaryColor")}
                  type="color"
                  className="w-12 h-10 p-1 cursor-pointer shrink-0 border bg-transparent"
                />
                <Input
                  {...form.register("primaryColor")}
                  placeholder="#16a34a"
                  className="font-mono text-sm uppercase"
                />
              </div>
              {form.formState.errors.primaryColor && (
                <p className="text-xs text-destructive">{form.formState.errors.primaryColor.message}</p>
              )}
            </div>

            {/* Secondary Color */}
            <div className="space-y-2">
              <Label htmlFor="secondaryColor">Secondary Color</Label>
              <div className="flex gap-2">
                <Input
                  id="secondaryColor"
                  {...form.register("secondaryColor")}
                  type="color"
                  className="w-12 h-10 p-1 cursor-pointer shrink-0 border bg-transparent"
                />
                <Input
                  {...form.register("secondaryColor")}
                  placeholder="#15803d"
                  className="font-mono text-sm uppercase"
                />
              </div>
              {form.formState.errors.secondaryColor && (
                <p className="text-xs text-destructive">{form.formState.errors.secondaryColor.message}</p>
              )}
            </div>

            {/* Accent Color */}
            <div className="space-y-2">
              <Label htmlFor="accentColor">Accent Color</Label>
              <div className="flex gap-2">
                <Input
                  id="accentColor"
                  {...form.register("accentColor")}
                  type="color"
                  className="w-12 h-10 p-1 cursor-pointer shrink-0 border bg-transparent"
                />
                <Input
                  {...form.register("accentColor")}
                  placeholder="#22c55e"
                  className="font-mono text-sm uppercase"
                />
              </div>
              {form.formState.errors.accentColor && (
                <p className="text-xs text-destructive">{form.formState.errors.accentColor.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => form.reset()}>
          Reset
        </Button>
        <Button type="submit" disabled={saving} style={{ backgroundColor: primaryColor, color: "white" }}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving Settings...
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </form>
  )
}
