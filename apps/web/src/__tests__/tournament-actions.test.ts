import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTenantContext } from "@mtk/database"
import {
  closeRegistration,
  createTournament,
  deleteTournament,
  getTournament,
  getTournaments,
  openRegistration,
  updateTournament,
} from "@/app/actions/tournaments"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveTenant: vi.fn(),
  authorize: vi.fn(),
  findUser: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({
  resolveActiveTenantId: mocks.resolveTenant,
  requirePermissionServer: mocks.authorize,
}))
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  return {
    ...actual,
    db: { query: { users: { findFirst: mocks.findUser } } },
    tournamentRepo: {
      insert: mocks.insert,
      updateById: mocks.update,
      deleteById: mocks.remove,
      findById: mocks.find,
      findFiltered: mocks.list,
    },
  }
})

const CLERK_ID = "user_clerk_identity"
const USER_ID = "7daa50a3-aace-4bd7-aa82-e5a0c248c656"
const ACTIVE_TENANT = "a53bc9d0-e872-440b-b0af-db4a8918a25f"
const TOURNAMENT_ID = "61d9249f-8389-4627-9cac-7e2ff4c48174"
const input = { name: "Premium League", format: "league" as const }

describe("Tournament action tenant and author boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(ACTIVE_TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.findUser.mockResolvedValue({ id: USER_ID })
    mocks.insert.mockImplementation(async () => {
      expect(getTenantContext()).toEqual({ userId: CLERK_ID, tenantId: ACTIVE_TENANT })
      return [{ id: TOURNAMENT_ID }]
    })
    mocks.update.mockResolvedValue({ id: TOURNAMENT_ID })
    mocks.remove.mockResolvedValue(true)
    mocks.find.mockResolvedValue({ id: TOURNAMENT_ID })
    mocks.list.mockResolvedValue({ data: [], total: 0 })
  })

  it("creates in the authorized active tenant using the database author UUID", async () => {
    const result = await createTournament(input)

    expect(mocks.resolveTenant).toHaveBeenCalledOnce()
    expect(mocks.authorize).toHaveBeenCalledWith("tournament:create", ACTIVE_TENANT)
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ columns: { id: true } }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: input.name,
      slug: "premium-league",
      createdBy: USER_ID,
    }))
    expect(result).toEqual({ success: true, tournament: { id: TOURNAMENT_ID } })
    expect(getTenantContext()).toBeNull()
  })

  it("rejects unauthenticated callers before resolving a tenant", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(createTournament(input)).rejects.toThrow("Unauthorized")
    expect(mocks.resolveTenant).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("fails closed when there is no active tenant", async () => {
    mocks.resolveTenant.mockResolvedValue(null)
    await expect(createTournament(input)).rejects.toThrow("Tenant not found")
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("does not write when permission is denied for the active tenant", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(createTournament(input)).rejects.toThrow("Forbidden")
    expect(mocks.findUser).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("does not write a Clerk ID when account provisioning is incomplete", async () => {
    mocks.findUser.mockResolvedValue(undefined)
    await expect(createTournament(input)).rejects.toThrow("account is still being set up")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("does not report success or revalidate when the insert returns no row", async () => {
    mocks.insert.mockResolvedValue([])
    await expect(createTournament(input)).rejects.toThrow("could not be created")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  const operations = [
    { name: "update", permission: "tournament:update", repo: mocks.update, run: () => updateTournament(TOURNAMENT_ID, { name: "Updated League" }) },
    { name: "delete", permission: "tournament:delete", repo: mocks.remove, run: () => deleteTournament(TOURNAMENT_ID) },
    { name: "read", permission: "tournament:read", repo: mocks.find, run: () => getTournament(TOURNAMENT_ID) },
    { name: "list", permission: "tournament:read", repo: mocks.list, run: () => getTournaments({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" }) },
    { name: "open registration", permission: "tournament:manage_registrations", repo: mocks.update, run: () => openRegistration(TOURNAMENT_ID) },
    { name: "close registration", permission: "tournament:manage_registrations", repo: mocks.update, run: () => closeRegistration(TOURNAMENT_ID) },
  ]

  it.each(operations)("$name authorizes the exact tenant passed to the repository", async ({ permission, repo, run }) => {
    repo.mockImplementation(async () => {
      expect(getTenantContext()?.tenantId).toBe(ACTIVE_TENANT)
      return { id: TOURNAMENT_ID }
    })
    await run()
    expect(mocks.authorize).toHaveBeenCalledWith(permission, ACTIVE_TENANT)
    expect(mocks.resolveTenant).toHaveBeenCalledOnce()
    expect(repo).toHaveBeenCalledOnce()
  })

  it.each(operations)("$name never reaches the repository after a permission rejection", async ({ repo, run }) => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(run()).rejects.toThrow("Forbidden")
    expect(repo).not.toHaveBeenCalled()
  })
})
