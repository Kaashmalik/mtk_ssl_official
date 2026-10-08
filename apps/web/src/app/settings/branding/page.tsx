import { BrandingSettings } from "@/components/settings/branding-settings";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/super-admin";

export default async function BrandingSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const isSuper = await isSuperAdmin();

  if (!isSuper) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <h1 className="text-2xl font-semibold">Access restricted</h1>
          <p className="text-muted-foreground mt-2">
            Branding, DNS verification, and system requirements are managed by the super admin.
            Please contact support if you need changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Branding Settings</h1>
        <p className="text-muted-foreground mt-2">
          Customize your league&apos;s appearance, domain, and branding. Enterprise plans include white-label options.
        </p>
      </div>
      <BrandingSettings />
    </div>
  );
}

