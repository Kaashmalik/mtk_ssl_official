import Image from "next/image";
import { getTenantWithBranding } from "@/lib/tenant";
import { ClerkSignIn } from "./clerk-sign-in";

async function getTenantBranding() {
  return getTenantWithBranding();
}

export default async function SignInPage() {
  const tenantData = await getTenantBranding();
  const branding = tenantData?.branding;

  // Apply custom styling if branding exists
  const customStyles = branding
    ? {
      primaryColor: branding.primaryColor || "#16a34a",
      logoUrl: branding.logoUrl,
      backgroundUrl: branding.loginPageBackgroundUrl,
    }
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-green-50 to-emerald-100 dark:from-gray-900 dark:to-gray-800 relative overflow-hidden">
      {/* Dynamic Background Elements for fallback */}
      {!branding?.loginPageBackgroundUrl && (
        <>
          <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-primary/20 blur-[128px] animate-pulse pointer-events-none" />
          <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-[128px] animate-pulse pointer-events-none" />
        </>
      )}

      {branding?.loginPageBackgroundUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${branding.loginPageBackgroundUrl})`,
            opacity: 0.1,
          }}
        />
      )}
      <div className="relative z-10 w-full max-w-md">
        {branding?.logoUrl && (
          <div className="mb-8 flex justify-center">
            <Image
              src={branding.logoUrl}
              alt={branding.appName || "Logo"}
              className="h-16 w-auto"
              width={256}
              height={64}
              unoptimized
            />
          </div>
        )}
        <ClerkSignIn primaryColor={customStyles?.primaryColor} />
      </div>
    </div>
  );
}

