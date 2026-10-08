/**
 * RBAC (Role-Based Access Control) utilities
 * Centralized permission system for all server actions and pages.
 */

export type UserRole =
  | "super_admin"
  | "league_owner"
  | "team_manager"
  | "coach"
  | "scorer"
  | "player"
  | "fan";

/**
 * All available permissions in the system
 */
export type Permission =
  // Tournament
  | "tournament:create"
  | "tournament:read"
  | "tournament:update"
  | "tournament:delete"
  | "tournament:manage_registrations"
  // Team
  | "team:create"
  | "team:read"
  | "team:update"
  | "team:delete"
  | "team:manage_roster"
  // Player
  | "player:create"
  | "player:read"
  | "player:update"
  | "player:delete"
  // Match
  | "match:create"
  | "match:read"
  | "match:update"
  | "match:delete"
  | "match:score"
  // Scorecard
  | "scorecard:create"
  | "scorecard:read"
  | "scorecard:update"
  // Stats
  | "stats:read"
  | "stats:manage"
  // Users
  | "user:manage"
  | "user:read"
  /** Invite team managers / coaches / scorers into your league */
  | "user:invite"
  /** Self-service: redeem an invitation you were sent */
  | "invite:accept"
  // Fan
  | "fan:follow"
  | "fan:read"
  // Registration
  | "registration:create"
  | "registration:manage"
  // Settings
  | "settings:manage";

/**
 * Permission matrix — defines which roles have which permissions
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    "tournament:create", "tournament:read", "tournament:update", "tournament:delete", "tournament:manage_registrations",
    "team:create", "team:read", "team:update", "team:delete", "team:manage_roster",
    "player:create", "player:read", "player:update", "player:delete",
    "match:create", "match:read", "match:update", "match:delete", "match:score",
    "scorecard:create", "scorecard:read", "scorecard:update",
    "stats:read", "stats:manage",
    "user:manage", "user:read", "user:invite", "invite:accept",
    "fan:follow", "fan:read",
    "registration:create", "registration:manage",
    "settings:manage",
  ],
  league_owner: [
    // League owners manage their own league — NOT platform-wide user management
    "tournament:create", "tournament:read", "tournament:update", "tournament:delete", "tournament:manage_registrations",
    "team:create", "team:read", "team:update", "team:delete", "team:manage_roster",
    "player:create", "player:read", "player:update", "player:delete",
    "match:create", "match:read", "match:update", "match:delete", "match:score",
    "scorecard:create", "scorecard:read", "scorecard:update",
    "stats:read", "stats:manage",
    "user:read", "user:invite", "invite:accept",
    "fan:follow", "fan:read",
    "registration:create", "registration:manage",
    "settings:manage",
  ],
  team_manager: [
    "tournament:read",
    "team:read", "team:update", "team:manage_roster",
    "player:read",
    "match:read",
    "scorecard:read",
    "stats:read",
    "user:read", "invite:accept",
    "fan:follow", "fan:read",
    "registration:create",
  ],
  coach: [
    "tournament:read",
    "team:read",
    "player:read",
    "match:read",
    "scorecard:read",
    "stats:read",
    "fan:follow", "fan:read",
  ],
  scorer: [
    "tournament:read",
    "team:read",
    "player:read",
    "match:read", "match:score",
    "scorecard:create", "scorecard:read", "scorecard:update",
    "stats:read",
    "invite:accept",
    "fan:follow", "fan:read",
  ],
  player: [
    "tournament:read",
    "team:read",
    "player:read",
    "match:read",
    "scorecard:read",
    "stats:read",
    "invite:accept",
    "fan:follow", "fan:read",
  ],
  fan: [
    "tournament:read",
    "team:read",
    "player:read",
    "match:read",
    "scorecard:read",
    "stats:read",
    "invite:accept",
    "fan:follow", "fan:read",
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Check if a role has ALL of the given permissions
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Check if a role has ANY of the given permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Role hierarchy for display purposes
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  league_owner: "League Owner",
  team_manager: "Team Manager",
  coach: "Coach",
  scorer: "Scorer",
  player: "Player",
  fan: "Fan",
};

/**
 * Role hierarchy level (higher = more permissions)
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  league_owner: 80,
  team_manager: 60,
  coach: 40,
  scorer: 40,
  player: 20,
  fan: 10,
};

/**
 * Check if roleA is higher or equal in hierarchy than roleB
 */
export function isRoleAboveOrEqual(roleA: UserRole, roleB: UserRole): boolean {
  return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB];
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  permission: Permission | null;
}

export function getNavigationForRole(role: UserRole) {
  const nav: NavItem[] = [
    { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", permission: null },
  ];

  if (hasPermission(role, "tournament:read")) {
    nav.push({ label: "Tournaments", href: "/dashboard/tournaments", icon: "Trophy", permission: "tournament:read" });
  }
  if (hasPermission(role, "team:read")) {
    nav.push({ label: "Teams", href: "/dashboard/teams", icon: "Shield", permission: "team:read" });
  }
  if (hasPermission(role, "player:read")) {
    nav.push({ label: "Players", href: "/dashboard/players", icon: "Users", permission: "player:read" });
  }
  if (hasPermission(role, "match:read")) {
    nav.push({ label: "Matches", href: "/dashboard/matches", icon: "Swords", permission: "match:read" });
  }
  if (hasPermission(role, "stats:read")) {
    nav.push({ label: "Statistics", href: "/dashboard/stats", icon: "BarChart3", permission: "stats:read" });
  }
  if (hasPermission(role, "registration:manage")) {
    nav.push({ label: "Registrations", href: "/dashboard/registrations", icon: "ClipboardList", permission: "registration:manage" });
  }
  if (hasPermission(role, "user:manage")) {
    nav.push({ label: "Users", href: "/dashboard/users", icon: "UserCog", permission: "user:manage" });
  }
  if (hasPermission(role, "settings:manage")) {
    nav.push({ label: "Settings", href: "/dashboard/settings", icon: "Settings", permission: "settings:manage" });
  }

  return nav;
}
