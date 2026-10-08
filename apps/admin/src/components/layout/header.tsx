"use client";

import { UserButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { Sun, Moon, Bell, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { useClerkReady } from "@/components/providers";

const routeLabels: Record<string, string> = {
  "/":               "Dashboard",
  "/tenants":        "Tenants",
  "/tournaments":    "Tournaments",
  "/teams":          "Teams",
  "/players":        "Players",
  "/matches":        "Matches",
  "/live-scoring":   "Live Scoring",
  "/commentary":     "Commentary",
  "/users":          "Users",
  "/venues":         "Venues",
  "/revenue":        "Revenue",
  "/announcements":  "Announcements",
  "/feature-flags":  "Feature Flags",
  "/system-health":  "System Health",
};

export function Header() {
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const clerkReady = useClerkReady();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const baseRoute = "/" + (pathname.split("/")[1] ?? "");
  const pageTitle = routeLabels[baseRoute] ?? routeLabels[pathname] ?? "Admin";

  return (
    <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/50 bg-background/90 backdrop-blur-xl px-6">
      {/* Left: Page title */}
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-base font-semibold text-foreground truncate">{pageTitle}</h2>
      </div>

      {/* Centre: Search */}
      <div className="hidden md:flex flex-1 max-w-xs">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search…"
            className="h-9 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Toggle theme"
        >
          {mounted && resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        {/* User avatar */}
        {clerkReady && <UserButton afterSignOutUrl="/login" />}
      </div>
    </header>
  );
}

