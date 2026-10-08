import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "@mtk/ui";
import { buildMetadata, siteConfig } from "@/lib/seo";
import { OrganizationJsonLd, WebApplicationJsonLd } from "@/components/seo/json-ld";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = buildMetadata();

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: siteConfig.themeColor },
    { media: "(prefers-color-scheme: dark)", color: "#0f0a1a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://anxstufkbqnjkxgksfkn.supabase.co" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <OrganizationJsonLd />
        <WebApplicationJsonLd />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
