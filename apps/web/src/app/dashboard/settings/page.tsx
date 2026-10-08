import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { getMyTenant } from "@/app/actions/tenants"
import { TenantSettingsForm } from "@/components/settings/tenant-settings-form"
import { UsageMeters } from "@/components/settings/usage-meters"
import { db, tenantBranding } from "@mtk/database"
import { eq } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"
import { Settings, CreditCard } from "lucide-react"

export default async function SettingsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const [branding] = await db.select().from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenant.id))
    .limit(1)

  const initialData = {
    name: tenant.name,
    appName: branding?.appName || null,
    logoUrl: branding?.logoUrl || null,
    faviconUrl: branding?.faviconUrl || null,
    primaryColor: branding?.primaryColor || null,
    secondaryColor: branding?.secondaryColor || null,
    accentColor: branding?.accentColor || null,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Customize your league profile, app settings, and team branding configurations.
        </p>
      </MotionWrapper>

      {/* Quick Links */}
      <MotionWrapper variant="fadeInUp" delay={0.05}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/dashboard/settings">
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="h-4 w-4" />
                  Branding & Appearance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Logo, colors, app name, and visual identity
                </p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/settings/billing">
            <Card className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Billing &amp; Plan
                  </span>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {tenant.plan}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Subscription plan, upgrades, and payment history
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </MotionWrapper>

      {/* Usage Meters */}
      <MotionWrapper variant="fadeInUp" delay={0.08}>
        <UsageMeters tenantId={tenant.id} plan={tenant.plan} />
      </MotionWrapper>

      {/* Branding Form */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <TenantSettingsForm initialData={initialData} />
      </MotionWrapper>
    </div>
  )
}
