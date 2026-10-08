import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import "./globals.css";
import { Toaster } from "@mtk/ui/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

export const metadata: Metadata = {
  title: "Shakir Super League - Pakistan's #1 Cricket Platform",
  description: "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
  keywords: ["cricket", "tournament", "league", "Pakistan", "scoring"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "SSL",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
        <ServiceWorkerRegistration />
        <CommandPaletteLoader />
      </body>
    </html>
  );
}

