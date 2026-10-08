import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.fullName,
    short_name: "SSL Admin",
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0f0a1a",
    theme_color: siteConfig.themeColor,
    orientation: "portrait-primary",
    scope: "/",
    lang: "en",
    categories: ["productivity", "sports", "business"],
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Dashboard", short_name: "Dashboard", url: "/", icons: [{ src: "/icon.svg", sizes: "any" }] },
      { name: "Tenants", short_name: "Tenants", url: "/tenants", icons: [{ src: "/icon.svg", sizes: "any" }] },
      { name: "Live Scoring", short_name: "Live", url: "/live-scoring", icons: [{ src: "/icon.svg", sizes: "any" }] },
    ],
  };
}
