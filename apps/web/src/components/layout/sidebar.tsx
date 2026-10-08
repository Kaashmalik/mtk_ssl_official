"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@mtk/ui/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useMemo } from "react"
import {
  LayoutDashboard, Users, Trophy, Sword, Settings,
  ChevronLeft, ChevronRight, BarChart3, Gamepad2, Shield, ClipboardList, UserCog
} from "lucide-react"
import { useUser } from "@clerk/nextjs"
import { Button } from "@mtk/ui/components/ui/button"
import { type UserRole, getNavigationForRole } from "@/lib/rbac"

// Map icon string names from rbac.ts to actual Lucide components
const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard,
  Trophy,
  Shield,
  Users,
  Swords: Sword,
  BarChart3,
  ClipboardList,
  UserCog,
  Settings,
}

type NavItem = {
  name: string
  href: string
  icon: typeof LayoutDashboard
  shortcut?: string
  badge?: "live"
}

type NavGroup = {
  label: string
  items: NavItem[]
}

// Default navigation for when role hasn't loaded yet (minimal)
const DEFAULT_NAV_GROUPS: NavGroup[] = [
  {
    label: "Management",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, shortcut: "⌘1" },
    ],
  },
]

// Keyboard shortcuts for the first 5 management items
const SHORTCUTS = ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5"]

/**
 * Build RBAC-filtered navigation groups from the user's role.
 */
function buildNavGroups(role: UserRole): NavGroup[] {
  const roleNav = getNavigationForRole(role)

  // Map RBAC nav items to our NavItem format with icons
  const items: NavItem[] = roleNav.map((item, i) => ({
    name: item.label,
    href: item.href,
    icon: ICON_MAP[item.icon] || LayoutDashboard,
    shortcut: i < SHORTCUTS.length ? SHORTCUTS[i] : undefined,
    badge: item.label === "Matches" ? "live" as const : undefined,
  }))

  // Split items into groups
  const managementItems = items.filter(i =>
    ["/dashboard", "/dashboard/tournaments", "/dashboard/teams", "/dashboard/players", "/dashboard/matches"].includes(i.href)
  )
  const analyticsItems = items.filter(i =>
    ["/dashboard/stats"].includes(i.href)
  )
  // Always add scoring if user has match:read or above
  if (analyticsItems.length > 0 || managementItems.some(i => i.href === "/dashboard/matches")) {
    analyticsItems.push({ name: "Scoring", href: "/dashboard/scoring", icon: Gamepad2 })
  }
  const systemItems = items.filter(i =>
    ["/dashboard/registrations", "/dashboard/users", "/dashboard/settings"].includes(i.href)
  )

  const groups: NavGroup[] = []
  if (managementItems.length > 0) groups.push({ label: "Management", items: managementItems })
  if (analyticsItems.length > 0) groups.push({ label: "Analytics", items: analyticsItems })
  if (systemItems.length > 0) groups.push({ label: "System", items: systemItems })

  return groups.length > 0 ? groups : DEFAULT_NAV_GROUPS
}

export function Sidebar({ userRole }: { userRole?: UserRole }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Build RBAC-filtered navigation
  const navGroups = useMemo(() => {
    if (!userRole) return DEFAULT_NAV_GROUPS
    return buildNavGroups(userRole)
  }, [userRole])

  // Keyboard shortcut to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "[" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCollapsed((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 280 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="hidden md:flex flex-col border-r glass-panel h-screen sticky top-0 z-40 overflow-hidden"
    >
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold overflow-hidden">
          <Trophy className="h-6 w-6 text-primary shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="whitespace-nowrap text-sm"
              >
                Shakir Super League
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-7 w-7 shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-2" aria-label="Main navigation">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <AnimatePresence>
              {!collapsed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {group.label}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="grid gap-0.5 px-2">
              {group.items.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300 relative group overflow-hidden",
                      "hover:bg-primary/5 hover:text-foreground",
                      isActive
                        ? "text-primary font-medium shadow-sm bg-linear-to-r from-primary/15 to-primary/5"
                        : "text-muted-foreground"
                    )}
                    title={collapsed ? item.name : undefined}
                    aria-label={collapsed ? item.name : undefined}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="activeNavIndicator"
                        className="absolute left-0 top-0 w-1 h-full bg-primary rounded-r-full" 
                      />
                    )}
                    <item.icon className={cn("h-4 w-4 shrink-0 relative z-10 transition-transform group-hover:scale-110", isActive && "text-primary")} />
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.div
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: "auto" }}
                          exit={{ opacity: 0, width: 0 }}
                          className="flex items-center justify-between flex-1 overflow-hidden"
                        >
                          <span className="whitespace-nowrap">{item.name}</span>
                          <div className="flex items-center gap-1.5">
                            {item.badge === "live" && (
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-live" />
                              </span>
                            )}
                            {item.shortcut && (
                              <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground/60">
                                {item.shortcut}
                              </kbd>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section at bottom */}
      <AnimatePresence>
        {!collapsed && <SidebarUserCard />}
      </AnimatePresence>
    </motion.aside>
  )
}

/**
 * Rendered only when <ClerkProvider> is mounted. useUser() throws when it is not,
 * so the hook has to live in a child that is never mounted without the provider.
 */
function SidebarUserCard() {
  const { user, isLoaded } = useUser()

  if (!isLoaded || !user) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="border-t p-3"
    >
      <div className="flex items-center gap-3 px-2">
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={user.fullName || "User Avatar"}
            className="h-8 w-8 rounded-full shrink-0 border border-primary/20"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
            {user.firstName?.charAt(0) || ""}{user.lastName?.charAt(0) || ""}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{user.fullName}</p>
          <p className="text-xs text-muted-foreground truncate">{user.primaryEmailAddress?.emailAddress}</p>
        </div>
      </div>
    </motion.div>
  )
}
