import { describe, it, expect } from "vitest";
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  isRoleAboveOrEqual,
  getNavigationForRole,
} from "../lib/rbac";

describe("Role-Based Access Control (RBAC) System", () => {
  it("should evaluate hasPermission correctly for different roles", () => {
    // Super admins have all permissions
    expect(hasPermission("super_admin", "tournament:create")).toBe(true);
    expect(hasPermission("super_admin", "user:manage")).toBe(true);

    // League owners have administrative permissions
    expect(hasPermission("league_owner", "tournament:create")).toBe(true);
    expect(hasPermission("league_owner", "settings:manage")).toBe(true);

    // Team managers are scoped by assigned-team checks and must not directly
    // create or edit arbitrary player records.
    expect(hasPermission("team_manager", "team:update")).toBe(true);
    expect(hasPermission("team_manager", "player:create")).toBe(false);
    expect(hasPermission("team_manager", "player:update")).toBe(false);

    // Scorers can score matches but not manage users
    expect(hasPermission("scorer", "match:score")).toBe(true);
    expect(hasPermission("scorer", "user:manage")).toBe(false);

    // Fans only have read and follow permissions
    expect(hasPermission("fan", "tournament:read")).toBe(true);
    expect(hasPermission("fan", "tournament:create")).toBe(false);
  });

  it("should evaluate hasAllPermissions correctly", () => {
    expect(hasAllPermissions("super_admin", ["tournament:create", "team:create", "player:create"])).toBe(true);
    expect(hasAllPermissions("scorer", ["tournament:read", "match:score"])).toBe(true);
    expect(hasAllPermissions("scorer", ["tournament:read", "user:manage"])).toBe(false);
  });

  it("should evaluate hasAnyPermission correctly", () => {
    expect(hasAnyPermission("scorer", ["user:manage", "match:score"])).toBe(true);
    expect(hasAnyPermission("fan", ["user:manage", "tournament:read"])).toBe(true);
    expect(hasAnyPermission("fan", ["user:manage", "tournament:create"])).toBe(false);
  });

  it("should evaluate isRoleAboveOrEqual correctly based on hierarchy levels", () => {
    expect(isRoleAboveOrEqual("super_admin", "league_owner")).toBe(true);
    expect(isRoleAboveOrEqual("league_owner", "team_manager")).toBe(true);
    expect(isRoleAboveOrEqual("scorer", "coach")).toBe(true); // Equal hierarchy (40)
    expect(isRoleAboveOrEqual("player", "super_admin")).toBe(false);
  });

  it("should generate correct navigation items for specific roles", () => {
    const fanNav = getNavigationForRole("fan");
    expect(fanNav.some((n) => n.href === "/dashboard/tournaments")).toBe(true);
    expect(fanNav.some((n) => n.href === "/dashboard/users")).toBe(false);

    const superAdminNav = getNavigationForRole("super_admin");
    expect(superAdminNav.some((n) => n.href === "/dashboard/users")).toBe(true);
    expect(superAdminNav.some((n) => n.href === "/dashboard/settings")).toBe(true);
  });
});
