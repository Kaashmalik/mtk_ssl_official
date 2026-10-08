import type { Metadata } from "next";

export const siteConfig = {
  name: "SSL Admin",
  fullName: "SSL Super Admin — Shakir Super League",
  description:
    "Secure super-admin control panel for the Shakir Super League platform. Manage tenants, tournaments, matches, players, revenue, and platform-wide settings.",
  url: process.env.NEXT_PUBLIC_ADMIN_URL || "https://admin.shakir-super-league.com",
  ogImage: "/og-image.svg",
  twitterHandle: "@ShakierSuperLeague",
  themeColor: "#7c3aed",
  keywords: [
    "SSL Admin",
    "Shakir Super League",
    "Cricket Admin Panel",
    "Pakistan Cricket League",
    "Tournament Management",
    "Super Admin Dashboard",
    "Malik Tech",
  ],
} as const;

type MetaOverride = {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
};

export function buildMetadata({
  title,
  description,
  path = "",
  noIndex = true,
}: MetaOverride = {}): Metadata {
  const pageTitle = title
    ? `${title} | ${siteConfig.name}`
    : siteConfig.fullName;
  const pageDesc = description ?? siteConfig.description;
  const canonical = `${siteConfig.url}${path}`;

  return {
    title: {
      default: pageTitle,
      template: `%s | ${siteConfig.name}`,
    },
    description: pageDesc,
    keywords: [...siteConfig.keywords],
    authors: [{ name: "Malik Tech", url: "https://maliktech.dev" }],
    creator: "Malik Tech",
    publisher: "Malik Tech",
    applicationName: siteConfig.fullName,
    generator: "Next.js",
    referrer: "strict-origin-when-cross-origin",
    metadataBase: new URL(siteConfig.url),
    alternates: {
      canonical,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: { index: false, follow: false },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
            "max-snippet": -1,
          },
        },
    openGraph: {
      type: "website",
      locale: "en_PK",
      url: canonical,
      title: pageTitle,
      description: pageDesc,
      siteName: siteConfig.fullName,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: pageTitle,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: pageDesc,
      creator: siteConfig.twitterHandle,
      site: siteConfig.twitterHandle,
      images: [siteConfig.ogImage],
    },
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      ],
      apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    manifest: "/manifest.webmanifest",
    category: "technology",
  };
}
