import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Bricolage_Grotesque } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { ChunkErrorRecovery } from "@/components/chunk-error-recovery";
import { getLocaleDirection } from "@/i18n/config";
import "./globals.css";
import { Toaster } from "@mtk/ui/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { TenantBrandingProvider } from "@/components/tenant-branding-provider";
import { SkipLink } from "@/components/skip-link";
import { TenantBrandNameProvider } from "@/components/tenant-brand-name";
import { resolveBrandName, shortTenantLabel } from "@/lib/white-label-metadata";
import { readRequestBrand } from "@/lib/request-brand";
import { brandVariables } from "@/lib/brand-presentation";

import { buildRootMetadata } from "@/lib/site-metadata";
import { buildTenantBrandMetadata } from "@/lib/white-label-metadata";

// Display face for headings only; body copy and numbers stay on Geist.
const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // Batch 115 white-label: the tenant's own product name and favicon are
  // rendered SERVER-side per host from the request brand — crawlers see the
  // tenant's brand directly, and pages without a specific title still read
  // as the tenant's product. A tenant without branding keeps the platform
  // default untouched (buildTenantBrandMetadata returns the seed as-is).
  return buildTenantBrandMetadata(buildRootMetadata(), await readRequestBrand());
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // UX-03 (Batch 139): the request locale resolves from cookie or
  // Accept-Language (no URL routing); Arabic renders right-to-left via the
  // dir attribute. Layout mirroring polish stays an explicitly open scope.
  const locale = await getLocale();
  const branding = await readRequestBrand();
  return (
    <html lang={locale} dir={getLocaleDirection(locale)} suppressHydrationWarning>
      <body style={brandVariables(branding)} className={`${GeistSans.variable} ${GeistMono.variable} ${displayFont.variable} font-sans antialiased`}>
        {branding?.customCss && (
          // PREM-02 (Batch 176): the published snapshot's customCss, injected
          // SERVER-side so the branded chrome never flashes unbranded. The
          // presentation layer already bounded its length and neutralized
          // `</style`; a <style> element's content is the one place raw CSS
          // belongs. dangerouslySetInnerHTML is deliberate here.
          <style id="tenant-custom-css" dangerouslySetInnerHTML={{ __html: branding.customCss }} />
        )}
        <NextIntlClientProvider>
        <Providers>
          <SkipLink />
          <TenantBrandingProvider branding={branding} />
          <TenantBrandNameProvider value={{
            name: resolveBrandName(branding),
            short: shortTenantLabel(branding),
            // Chrome identity joins the context in Batch 176: the tenant's
            // own logo in the switcher slot, and the Pro/Enterprise credit
            // gate (undefined on unbranded hosts - defaults inherited).
            logoUrl: branding?.logoUrl,
            hideSslBranding: branding?.hideSslBranding,
          }}>
          <div id="main-content">
          {children}
          </div>
          </TenantBrandNameProvider>
          <Toaster />
        </Providers>
        </NextIntlClientProvider>
        <ServiceWorkerRegistration />
        <ChunkErrorRecovery />
        <CommandPaletteLoader />
      </body>
    </html>
  );
}

