"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, Trophy, Users2, PersonStanding,
  Calendar, Radio, Mic2, MapPin, DollarSign, Megaphone,
  ToggleLeft, Activity, ShieldCheck, ChevronRight, CreditCard,
} from "lucide-react";

const navGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard",    href: "/",             icon: LayoutDashboard },
    ],
  },
  {
    label: "Cricket",
    items: [
      { name: "Tenants",      href: "/tenants",      icon: Building2 },
      { name: "Tournaments",  href: "/tournaments",  icon: Trophy },
      { name: "Teams",        href: "/teams",        icon: Users2 },
      { name: "Players",      href: "/players",      icon: PersonStanding },
      { name: "Matches",      href: "/matches",      icon: Calendar },
      { name: "Venues",       href: "/venues",       icon: MapPin },
    ],
  },
  {
    label: "Live",
    items: [
      { name: "Live Scoring", href: "/live-scoring", icon: Radio },
      { name: "Commentary",   href: "/commentary",   icon: Mic2 },
    ],
  },
  {
    label: "Platform",
    items: [
      { name: "Users",         href: "/users",         icon: Users2 },
      { name: "Revenue",       href: "/revenue",       icon: DollarSign },
      { name: "Payments",      href: "/payments",      icon: CreditCard },
      { name: "Branding",      href: "/white-label",   icon: ShieldCheck },
      { name: "Waitlist",      href: "/waitlist",      icon: Megaphone },
      { name: "Announcements", href: "/announcements", icon: Megaphone },
      { name: "Feature Flags", href: "/feature-flags", icon: ToggleLeft },
      { name: "System Health", href: "/system-health", icon: Activity },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex h-full w-64 flex-col"
      style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      {/* Logo */}
      <div
        className="flex h-16 items-center gap-3 px-5"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg">
          <ShieldCheck className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-[13px] font-bold leading-none" style={{ color: "var(--sidebar-foreground)" }}>
            SSL Admin
          </div>
          <div className="text-[10px] mt-0.5 font-medium uppercase tracking-widest opacity-50" style={{ color: "var(--sidebar-foreground)" }}>
            Super Admin
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div
              className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--sidebar-foreground)", opacity: 0.4 }}
            >
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150"
                    style={{
                      color: isActive
                        ? "white"
                        : "var(--sidebar-foreground)",
                      background: isActive
                        ? "oklch(0.55 0.22 280 / 0.85)"
                        : "transparent",
                      opacity: isActive ? 1 : 0.72,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = "var(--sidebar-accent)";
                        (e.currentTarget as HTMLElement).style.opacity = "1";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.opacity = "0.72";
                      }
                    }}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110"
                      style={{ color: isActive ? "white" : "var(--sidebar-foreground)" }}
                    />
                    <span className="flex-1 truncate">{item.name}</span>
                    {isActive && (
                      <ChevronRight className="h-3 w-3 opacity-60" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--sidebar-accent)" }}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/30 text-xs font-bold text-white">
            S
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold" style={{ color: "var(--sidebar-foreground)" }}>
              Super Admin
            </div>
            <div className="truncate text-[10px] opacity-50" style={{ color: "var(--sidebar-foreground)" }}>
              {process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "admin"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
