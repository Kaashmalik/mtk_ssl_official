import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { getLocaleDirection } from "@/i18n/config";
import "./globals.css";
import { Toaster } from "@mtk/ui/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { TenantBrandingProvider } from "@/components/tenant-branding-provider";
import { readRequestBrand } from "@/lib/request-brand";
import { brandVariables } from "@/lib/brand-presentation";

import { buildRootMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = buildRootMetadata();

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
      <body style={brandVariables(branding)} className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <NextIntlClientProvider>
        <Providers>
          <TenantBrandingProvider branding={branding} />
          {children}
          <Toaster />
        </Providers>
        </NextIntlClientProvider>
        <ServiceWorkerRegistration />
        <CommandPaletteLoader />
      </body>
    </html>
  );
}

