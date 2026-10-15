import { vi, describe, it, expect, beforeEach } from "vitest";
import { createTenant, getMyTenant } from "../app/actions/tenants";
import { createPlayer } from "../app/actions/players";
import { createMatch } from "../app/actions/matches";
import { auth } from "@clerk/nextjs/server";
import { db, playerRepo, players, auditLogs } from "@mtk/database";

const MOCK_TENANT_ID = "da7c0ab5-0810-482a-a92c-886a87754b2d";
const MOCK_TEAM_A_ID = "da7c0ab5-0810-482a-a92c-886a87754b2e";
const MOCK_TEAM_B_ID = "da7c0ab5-0810-482a-a92c-886a87754b2f";

// Mock @clerk/nextjs/server
vi.mock("@clerk/nextjs/server", () => {
  return {
    auth: vi.fn().mockImplementation(async () => ({
      userId: "mock-user-123",
    })),
  };
});

// Mock @mtk/database
//
// Uses `importOriginal` so the real `PLAN_LIMITS` / `getPlanLimits` come through
// untouched. Hand-copying plan limits into the mock would drift the moment the
// tiers change, and omitting them entirely is what made every plan-gated action
// throw a TypeError inside the mock.
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>();

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => []),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => []),
    // `tx.execute` runs the FOR UPDATE row locks inside transactions (e.g. the
    // serialized one-league cap in createTenant).
    execute: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(mockDb)),
  };

  // NOTE: these repo mocks must NOT reach into `mockDb`. The previous
  // implementation did `mockDb.insert(null).values(null).returning()[0]`, which
  // *consumed* one queued `mockReturnValueOnce` from the shared `returning`
  // mock. A test that threw before its own insert left that value queued, and
  // the next test's repo call silently swallowed it — which is how `createMatch`
  // ended up asserting against the `createPlayer` fixture.
  const playerRepo = {
    insertOne: vi.fn(),
    updateById: vi.fn().mockResolvedValue(undefined),
    deleteById: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };

  const teamRepo = {
    findById: vi.fn().mockResolvedValue(null),
  };

  return {
    ...actual,
    db: mockDb,
    playerRepo,
    teamRepo,
    withTenantContext: vi.fn().mockImplementation(async (_ctx, fn) => fn()),
    withoutTenantContext: vi.fn().mockImplementation(async (fn) => fn()),
  };
});

// Mock next/cache
vi.mock("next/cache", () => {
  return {
    revalidatePath: vi.fn(),
  };
});
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: vi.fn().mockResolvedValue(null) }));

// Mock rbac-server to bypass the auth checks or return mock values
vi.mock("../lib/rbac-server", () => {
  return {
    requirePermissionServer: vi.fn().mockImplementation(async () => {}),
    resolveActiveTenantId: vi.fn().mockImplementation(async () => MOCK_TENANT_ID),
  };
});

describe("Server Actions Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Tenants Action - getMyTenant", () => {
    it("should return null if user is not authenticated", async () => {
      // Mock auth to return no userId
      vi.mocked(auth).mockImplementationOnce(async () => ({} as any));

      const tenant = await getMyTenant();
      expect(tenant).toBeNull();
    });

    it("should fetch tenant for the logged-in user", async () => {
      const mockTenant = { id: MOCK_TENANT_ID, ownerId: "mock-db-user-id" };
      vi.mocked((db as any).limit)
        .mockReturnValueOnce([{ id: "mock-db-user-id", isActive: true }] as any)
        .mockReturnValueOnce([{ tenant: mockTenant }] as any);

      const tenant = await getMyTenant();
      expect(tenant).toEqual(mockTenant);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe("Tenants Action - createTenant", () => {
    it("should throw error if user is unauthorized", async () => {
      vi.mocked(auth).mockImplementationOnce(async () => ({} as any));

      await expect(
        createTenant({ name: "My League", slug: "my-league" })
      ).rejects.toThrow("Unauthorized");
    });

    it("should successfully insert a new tenant when valid input is passed", async () => {
      // Stub database user lookup, existing-tenant check, and slug check.
      vi.mocked((db as any).limit)
        .mockReturnValueOnce([{ id: "mock-db-user-id", tenantIds: [], isActive: true }] as any)
        .mockReturnValueOnce([]) // existing tenant check
        .mockReturnValueOnce([]); // slugTaken check

      const mockNewTenant = { id: MOCK_TENANT_ID, name: "My League", slug: "my-league" };
      vi.mocked((db as any).returning).mockReturnValueOnce([mockNewTenant] as any);

      const response = await createTenant({ name: "My League", slug: "my-league" });
      expect(response.success).toBe(true);
      expect(response.tenant).toEqual(mockNewTenant);
      expect(db.transaction).toHaveBeenCalledOnce();
      expect((db as any).values).toHaveBeenNthCalledWith(1, expect.objectContaining({
        ownerId: "mock-db-user-id",
        plan: "free",
      }));
      expect((db as any).values).toHaveBeenNthCalledWith(2, expect.objectContaining({
        plan: "free",
        monthlyAmount: "0",
      }));
    });
  });

  describe("Players Action - createPlayer", () => {
    it("should create a player successfully with valid permissions and tenant metadata", async () => {
      const actor = { id: "da7c0ab5-0810-482a-a92c-886a87754b20", clerkId: "mock-user-123", isActive: true };
      const mockTenant = { id: MOCK_TENANT_ID, isActive: true, plan: "enterprise" };
      const mockNewPlayer = { id: "player-123", name: "John Doe", tenantId: MOCK_TENANT_ID };
      // Player creation checks current locked authority, counts, insertion and
      // audit inside one transaction; it no longer uses getMyTenant/repo writes.
      const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
      vi.mocked(db.transaction).mockImplementationOnce(async (callback: any) => callback({
        ...db, execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: countWhere }) }),
        query: {
          users: { findFirst: vi.fn().mockResolvedValue(actor) },
          tenants: { findFirst: vi.fn().mockResolvedValue(mockTenant) },
          userTenantRoles: { findFirst: vi.fn().mockResolvedValue({ userId: actor.id,
            tenantId: MOCK_TENANT_ID, role: "league_owner", status: "active" }) },
        },
      }));
      vi.mocked((db as any).returning).mockReturnValueOnce([mockNewPlayer]);

      const response = await createPlayer({
        name: "John Doe",
        tenantId: MOCK_TENANT_ID,
        role: "batsman",
        battingStyle: "right",
      });

      expect(response.success).toBe(true);
      expect(response.player).toEqual(mockNewPlayer);
      expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" });
      expect(playerRepo.insertOne).not.toHaveBeenCalled();
      expect(db.insert).toHaveBeenNthCalledWith(1, players);
      expect(db.insert).toHaveBeenNthCalledWith(2, auditLogs);
      expect((db as any).values).toHaveBeenNthCalledWith(1, expect.objectContaining({
        tenantId: MOCK_TENANT_ID, createdBy: actor.id,
      }));
    });
  });

  describe("Matches Action - createMatch", () => {
    it("should create a match successfully under active tenant context", async () => {
      const mockTenant = { id: MOCK_TENANT_ID, name: "Test Tenant", isActive: true };
      const actor = { id: "da7c0ab5-0810-482a-a92c-886a87754b20", clerkId: "mock-user-123", isActive: true };
      const mockTeamA = { id: MOCK_TEAM_A_ID, name: "Team A", tenantId: MOCK_TENANT_ID, isActive: true };
      const mockTeamB = { id: MOCK_TEAM_B_ID, name: "Team B", tenantId: MOCK_TENANT_ID, isActive: true };

      // Match creation now authorizes the current account/membership and reads
      // locked resources inside its own transaction, without getMyTenant.
      vi.mocked(db.transaction).mockImplementationOnce(async (callback: any) => callback({
        ...db, execute: vi.fn().mockResolvedValue([]), query: {
          users: { findFirst: vi.fn().mockResolvedValue(actor) },
          tenants: { findFirst: vi.fn().mockResolvedValue(mockTenant) },
          userTenantRoles: { findFirst: vi.fn().mockResolvedValue({ userId: actor.id,
            tenantId: MOCK_TENANT_ID, role: "league_owner", status: "active" }) },
          teams: { findFirst: vi.fn().mockResolvedValueOnce(mockTeamA).mockResolvedValueOnce(mockTeamB) },
        },
      }));

      const mockNewMatch = { id: "match-123", tenantId: MOCK_TENANT_ID, teamAId: MOCK_TEAM_A_ID, teamBId: MOCK_TEAM_B_ID };
      vi.mocked((db as any).returning).mockReturnValueOnce([mockNewMatch]);

      const response = await createMatch({
        teamAId: MOCK_TEAM_A_ID,
        teamBId: MOCK_TEAM_B_ID,
        scheduledDate: new Date().toISOString(),
        matchFormat: "t20",
        matchType: "group",
        totalOvers: 20,
      });

      expect(response.success).toBe(true);
      expect(response.match).toEqual(mockNewMatch);
      expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" });
    });
  });
});
