import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url;
  const now = new Date();

  const routes = [
    { path: "/", priority: 1.0, changeFrequency: "daily" as const },
    { path: "/tenants", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/leagues", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/tournaments", priority: 0.8, changeFrequency: "daily" as const },
    { path: "/matches", priority: 0.8, changeFrequency: "hourly" as const },
    { path: "/live-scoring", priority: 0.8, changeFrequency: "always" as const },
    { path: "/teams", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/players", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/venues", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/commentary", priority: 0.6, changeFrequency: "hourly" as const },
    { path: "/revenue", priority: 0.6, changeFrequency: "daily" as const },
    { path: "/system-health", priority: 0.5, changeFrequency: "always" as const },
    { path: "/announcements", priority: 0.5, changeFrequency: "weekly" as const },
    { path: "/commission", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/feature-flags", priority: 0.4, changeFrequency: "weekly" as const },
    { path: "/white-label", priority: 0.4, changeFrequency: "weekly" as const },
    { path: "/users", priority: 0.4, changeFrequency: "weekly" as const },
    { path: "/waitlist", priority: 0.4, changeFrequency: "weekly" as const },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
