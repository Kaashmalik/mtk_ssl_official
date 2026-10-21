import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  MEDIA_BINDING_PERMISSION,
  MediaAuthorizationError,
  assertMediaResourceAccess,
  requireMediaActor,
  requireMediaMember,
  type MediaActor,
} from "@/lib/media-authorization"

/**
 * ENH-07-02: scoped media authority.
 *
 * Class permission is necessary but not sufficient. These pin the composition:
 * active account + active membership + capability + tenant ownership + durable
 * team/player grant, with foreign resources refused before any quota/signature.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTenantId: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  tenant: vi.fn(),
  select: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.resolveActiveTenantId }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    query: {
      users: { findFirst: mocks.user },
      userTenantRoles: { findFirst: mocks.membership },
      tenants: { findFirst: mocks.tenant },
    },
    select: mocks.select,
  },
}))

const TENANT = "00000000-0000-4000-8000-0000000000a1"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000a2"
const ACTOR = "00000000-0000-4000-8000-0000000000b1"
const TEAM = "00000000-0000-4000-8000-0000000000c1"
const PLAYER = "00000000-0000-4000-8000-0000000000d1"

const ACTOR_CTX: MediaActor = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk_1", role: "league_owner" }

function membership(overrides: Record<string, unknown> = {}) {
  return {
    userId: ACTOR, tenantId: TENANT, role: "league_owner",
    status: "active", expiresAt: null,
    ...overrides,
  }
}

function selectRows(...rows: unknown[][]) {
  const queue = [...rows]
  mocks.select.mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => queue.shift() ?? [],
    }
    return chain
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
  mocks.resolveActiveTenantId.mockResolvedValue(TENANT)
  mocks.user.mockResolvedValue({ id: ACTOR, clerkId: "clerk_1", isActive: true })
  mocks.membership.mockResolvedValue(membership())
  mocks.tenant.mockResolvedValue({ id: TENANT, isActive: true })
})

describe("ENH-07-02: active member resolution", () => {
  it("refuses an anonymous request", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "unauthorized" })
  })

  it("refuses a missing or deactivated account", async () => {
    mocks.user.mockResolvedValue(null)
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "account_unavailable" })
    mocks.user.mockResolvedValue({ id: ACTOR, clerkId: "clerk_1", isActive: false })
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "account_unavailable" })
  })

  it("refuses a suspended, expired or platform membership", async () => {
    mocks.membership.mockResolvedValue(membership({ status: "suspended" }))
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "membership_unavailable" })

    mocks.membership.mockResolvedValue(membership({
      expiresAt: new Date(Date.now() - 1_000),
    }))
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "membership_unavailable" })

    mocks.membership.mockResolvedValue(membership({ role: "super_admin" }))
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "membership_unavailable" })
  })

  it("refuses a missing or inactive league", async () => {
    // The real query filters is_active, so an inactive league reads as absent.
    mocks.tenant.mockResolvedValue(null)
    await expect(requireMediaMember()).rejects.toMatchObject({ code: "tenant_not_found" })
  })

  it("requires the class permission for the intended binding", async () => {
    mocks.membership.mockResolvedValue(membership({ role: "scorer" }))
    await expect(requireMediaActor("team")).rejects.toMatchObject({ code: "permission_denied" })
    await expect(requireMediaActor("match")).rejects.toMatchObject({ code: "permission_denied" })

    mocks.membership.mockResolvedValue(membership({ role: "team_manager" }))
    await expect(requireMediaActor("team")).resolves.toMatchObject({ role: "team_manager" })
    await expect(requireMediaActor("branding")).rejects.toMatchObject({ code: "permission_denied" })
  })

  it("maps each binding to an existing capability without widening any role", () => {
    expect(MEDIA_BINDING_PERMISSION).toEqual({
      branding: "settings:manage",
      tournament: "tournament:update",
      venue: "venue:manage",
      team: "team:update",
      player: "player:update",
      match: "match:update",
    })
  })
})

describe("ENH-07-02: resource scoping", () => {
  it("requires branding to target the actor's own league", async () => {
    await expect(assertMediaResourceAccess({
      actor: ACTOR_CTX, bindingType: "branding", resourceId: OTHER_TENANT,
    })).rejects.toMatchObject({ code: "foreign_resource" })
    await expect(assertMediaResourceAccess({
      actor: ACTOR_CTX, bindingType: "branding", resourceId: TENANT,
    })).resolves.toBeUndefined()
  })

  it("refuses a foreign team even when a manager pointer exists", async () => {
    selectRows([{ tenantId: OTHER_TENANT, managerId: ACTOR, captainId: null }])
    await expect(assertMediaResourceAccess({
      actor: { ...ACTOR_CTX, role: "team_manager" }, bindingType: "team", resourceId: TEAM,
    })).rejects.toMatchObject({ code: "foreign_resource" })
  })

  it("requires the durable team pointer for non-owners", async () => {
    selectRows([{ tenantId: TENANT, managerId: "someone-else", captainId: null }])
    await expect(assertMediaResourceAccess({
      actor: { ...ACTOR_CTX, role: "team_manager" }, bindingType: "team", resourceId: TEAM,
    })).rejects.toMatchObject({ code: "resource_grant_required" })

    selectRows([{ tenantId: TENANT, managerId: ACTOR, captainId: null }])
    await expect(assertMediaResourceAccess({
      actor: { ...ACTOR_CTX, role: "team_manager" }, bindingType: "team", resourceId: TEAM,
    })).resolves.toBeUndefined()
  })

  it("lets an owner manage any team in the league without a pointer", async () => {
    selectRows([{ tenantId: TENANT, managerId: null, captainId: null }])
    await expect(assertMediaResourceAccess({
      actor: ACTOR_CTX, bindingType: "team", resourceId: TEAM,
    })).resolves.toBeUndefined()
  })

  it("scopes a player photo through the player's team grant", async () => {
    selectRows(
      [{ tenantId: TENANT, teamId: TEAM }],
      [{ tenantId: TENANT, managerId: ACTOR, captainId: null }],
    )
    await expect(assertMediaResourceAccess({
      actor: { ...ACTOR_CTX, role: "team_manager" }, bindingType: "player", resourceId: PLAYER,
    })).resolves.toBeUndefined()
  })

  it("refuses an unassigned player photo for a non-owner", async () => {
    selectRows([{ tenantId: TENANT, teamId: null }])
    await expect(assertMediaResourceAccess({
      actor: { ...ACTOR_CTX, role: "team_manager" }, bindingType: "player", resourceId: PLAYER,
    })).rejects.toMatchObject({ code: "resource_grant_required" })
  })

  it("refuses a resource that does not exist", async () => {
    selectRows([])
    await expect(assertMediaResourceAccess({
      actor: ACTOR_CTX, bindingType: "tournament", resourceId: TEAM,
    })).rejects.toBeInstanceOf(MediaAuthorizationError)
  })
})
