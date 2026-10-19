import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userTenantRoles, ownershipTransfers, auditLogs } from "@mtk/database"
import {
  getOwnershipTransfer, initiateOwnershipTransfer, acceptOwnershipTransfer, cancelOwnershipTransfer,
} from "@/app/actions/ownership"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
  transfer: vi.fn(), member: vi.fn(), user: vi.fn(), league: vi.fn(),
  txSelect: vi.fn(), txFrom: vi.fn(), txWhere: vi.fn(), txLimit: vi.fn(),
  insert: vi.fn(), values: vi.fn(), insertReturning: vi.fn(),
  update: vi.fn(), set: vi.fn(), updateWhere: vi.fn(), updateReturning: vi.fn(),
  select: vi.fn(), from: vi.fn(), join: vi.fn(), where: vi.fn(), limit: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  transaction: mocks.transaction, select: mocks.select,
} }))

const A = "00000000-0000-4000-8000-000000000001"
const OWNER = "00000000-0000-4000-8000-000000000004"
const ALI = "00000000-0000-4000-8000-000000000005"
const OWNER_MEM = "00000000-0000-4000-8000-00000000000a"
const ALI_MEM = "00000000-0000-4000-8000-00000000000b"
const TRANSFER = "00000000-0000-4000-8000-00000000000c"
const LATER = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 60 * 1000)

const dialect = new PgDialect()

const ownerMember = { id: OWNER_MEM, userId: OWNER, tenantId: A, role: "league_owner", status: "active", version: 3 }
const aliMember = { id: ALI_MEM, userId: ALI, tenantId: A, role: "scorer", status: "active", version: 2 }
const league = { id: A, ownerId: OWNER, isActive: true }
const ownerAccount = { id: OWNER, clerkId: "clerk-owner", isActive: true, role: "player" }
const aliAccount = { id: ALI, clerkId: "clerk-ali", isActive: true, role: "player" }
const pendingTransfer = {
  id: TRANSFER, tenantId: A, fromUserId: OWNER, toUserId: ALI, demotedRole: "team_manager",
  status: "pending", version: 0, expiresAt: LATER,
}

function txObject() {
  return {
    execute: mocks.execute,
    query: {
      ownershipTransfers: { findFirst: mocks.transfer },
      userTenantRoles: { findFirst: mocks.member },
      users: { findFirst: mocks.user },
      tenants: { findFirst: mocks.league },
    },
    select: mocks.txSelect, insert: mocks.insert, update: mocks.update,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-owner", sessionClaims: { fva: [0, 0] } })
  mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role: "league_owner" } })
  mocks.execute.mockResolvedValue([])
  mocks.insert.mockReturnValue({ values: mocks.values })
  // values() must be awaitable (audit insert) and expose .returning() (transfer insert).
  mocks.values.mockImplementation(() => Object.assign(Promise.resolve(undefined), { returning: mocks.insertReturning }))
  mocks.insertReturning.mockResolvedValue([{ id: TRANSFER, expiresAt: LATER }])
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.updateWhere })
  mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning })
  mocks.updateReturning.mockResolvedValue([])
  mocks.txSelect.mockReturnValue({ from: mocks.txFrom })
  mocks.txFrom.mockReturnValue({ where: mocks.txWhere })
  mocks.txWhere.mockReturnValue({ limit: mocks.txLimit })
  mocks.txLimit.mockResolvedValue([])
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.join })
  mocks.join.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
  mocks.transaction.mockImplementation(async fn => fn(txObject()))
  mocks.user.mockResolvedValue(ownerAccount)
  mocks.league.mockResolvedValue(league)
  mocks.member.mockResolvedValue(ownerMember)
})

/** Owner initiating a handover to Ali. */
function setupInitiate() {
  mocks.member.mockResolvedValueOnce(aliMember).mockResolvedValueOnce(ownerMember).mockResolvedValueOnce(aliMember)
  mocks.user.mockResolvedValueOnce(ownerAccount).mockResolvedValueOnce(aliAccount)
  mocks.league.mockResolvedValue(league)
  mocks.txLimit.mockResolvedValue([])
}

/** Ali accepting a handover from the owner. */
function setupAccept(transfer = pendingTransfer) {
  mocks.auth.mockResolvedValue({ userId: "clerk-ali", sessionClaims: { fva: [0, 0] } })
  mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: ALI, role: "team_manager" } })
  mocks.transfer.mockResolvedValueOnce(transfer).mockResolvedValueOnce(transfer)
  mocks.league.mockResolvedValue(league)
  mocks.member.mockResolvedValueOnce(ownerMember).mockResolvedValueOnce(aliMember)
  mocks.user.mockResolvedValueOnce(ownerAccount).mockResolvedValueOnce(aliAccount)
  mocks.updateReturning
    .mockResolvedValueOnce([{ membershipId: ALI_MEM, role: "league_owner", status: "active", version: 3 }])
    .mockResolvedValueOnce([{ membershipId: OWNER_MEM, role: "team_manager", status: "active", version: 4 }])
    .mockResolvedValueOnce([{ id: A }])
    .mockResolvedValueOnce([{ id: TRANSFER }])
}

const resolveKey = { tenantId: A, transferId: TRANSFER, expectedVersion: 0 }
const offer = { tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" } as const

function setupCancel(recipient = false) {
  if (recipient) {
    mocks.auth.mockResolvedValue({ userId: "clerk-ali", sessionClaims: { fva: [0, 0] } })
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: ALI, role: "scorer" } })
    mocks.user.mockResolvedValue(aliAccount)
    mocks.member.mockResolvedValue(aliMember)
  }
  mocks.transfer.mockResolvedValue(pendingTransfer)
  mocks.updateReturning.mockResolvedValue([{ id: TRANSFER }])
}

function expectNoWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

describe("Ownership transfer under-lock authorization regressions", () => {
  it.each([null, "another-clerk"])("initiation rejects a remapped session %s", async clerkId => {
    setupInitiate()
    mocks.user.mockReset().mockResolvedValueOnce({ ...ownerAccount, clerkId }).mockResolvedValueOnce(aliAccount)
    await expect(initiateOwnershipTransfer(offer)).rejects.toThrow("recorded league owner")
    expectNoWrites()
  })

  it.each([undefined, { ...ownerAccount, isActive: false }, { ...ownerAccount, id: ALI }])(
    "acceptance rejects a missing, disabled or mismatched outgoing account %s", async account => {
      setupAccept()
      mocks.user.mockReset().mockResolvedValueOnce(account).mockResolvedValueOnce(aliAccount)
      await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("no longer valid")
      expectNoWrites()
    },
  )

  it.each([undefined, { ...aliAccount, isActive: false }, { ...aliAccount, id: OWNER },
    { ...aliAccount, clerkId: null }, { ...aliAccount, clerkId: "another-clerk" }])(
    "acceptance rejects an invalid current recipient account/session %s", async account => {
      setupAccept()
      mocks.user.mockReset().mockResolvedValueOnce(ownerAccount).mockResolvedValueOnce(account)
      await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("account or session changed")
      expectNoWrites()
    },
  )

  it.each(["league_owner", "super_admin"])("acceptance rejects newly privileged membership %s", async role => {
    setupAccept()
    mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValueOnce({ ...aliMember, role })
    await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("owner or platform")
    expectNoWrites()
  })

  it("acceptance rejects a newly privileged platform account despite an ordinary league role", async () => {
    setupAccept()
    mocks.user.mockReset().mockResolvedValueOnce(ownerAccount).mockResolvedValueOnce({ ...aliAccount, role: "super_admin" })
    await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("owner or platform")
    expectNoWrites()
  })

  it.each([undefined, { ...aliMember, tenantId: OWNER }, { ...aliMember, userId: OWNER }, { ...aliMember, status: "pending" }])(
    "acceptance rejects missing, foreign or inactive recipient membership %s", async member => {
      setupAccept()
      mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValueOnce(member)
      await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("no longer active")
      expectNoWrites()
    },
  )

  it.each([undefined, { ...league, isActive: false }, { ...league, id: OWNER }])(
    "acceptance rejects a missing, disabled or foreign league %s", async currentLeague => {
      setupAccept()
      mocks.league.mockResolvedValue(currentLeague)
      await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow("Ownership changed")
      expectNoWrites()
    },
  )

  it.each(["accept", "cancel"])("%s rejects changed parties after locking the original accounts", async operation => {
    if (operation === "accept") setupAccept()
    else setupCancel(true)
    mocks.transfer.mockReset().mockResolvedValueOnce(pendingTransfer)
      .mockResolvedValueOnce({ ...pendingTransfer, fromUserId: TRANSFER })
    await expect(operation === "accept" ? acceptOwnershipTransfer(resolveKey) : cancelOwnershipTransfer(resolveKey))
      .rejects.toThrow("parties changed")
    expectNoWrites()
  })

  it.each(["league_owner", "super_admin", "not-a-role"])("acceptance rejects unsafe persisted demotion %s", async demotedRole => {
    setupAccept({ ...pendingTransfer, demotedRole })
    await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow()
    expectNoWrites()
  })

  it("requires a fresh database wall-clock expiry predicate at the final acceptance claim", async () => {
    setupAccept()
    await acceptOwnershipTransfer(resolveKey)
    const finalClaim = dialect.sqlToQuery(mocks.updateWhere.mock.calls[3][0])
    expect(finalClaim.params).toEqual([TRANSFER, A, OWNER, ALI, "pending", 0])
    expect(finalClaim.sql).toContain('"expires_at" > clock_timestamp()')
    expect(dialect.sqlToQuery(mocks.set.mock.calls[3][0].resolvedAt).sql).toBe("clock_timestamp()")
    const lockedRead = dialect.sqlToQuery(mocks.transfer.mock.calls[1][0].where)
    expect(lockedRead.params).toEqual([TRANSFER, A])
    // Fresh accounts/memberships must be read after all four ordered locks.
    expect(mocks.user.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
  })

  it.each([1, 2, 3, 4])("rejects lost conditional acceptance write %s without audit or cache invalidation", async lostWrite => {
    setupAccept()
    mocks.updateReturning.mockReset()
    for (let i = 1; i < lostWrite; i++) mocks.updateReturning.mockResolvedValueOnce([{ id: "updated" }])
    mocks.updateReturning.mockResolvedValueOnce([])
    await expect(acceptOwnershipTransfer(resolveKey)).rejects.toThrow(/changed|expired/)
    expect(mocks.update).toHaveBeenCalledTimes(lostWrite)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects a lost expiry sweep instead of issuing another pending offer", async () => {
    setupInitiate()
    mocks.txLimit.mockResolvedValue([{ id: TRANSFER, expiresAt: PAST, version: 0 }])
    await expect(initiateOwnershipTransfer(offer)).rejects.toThrow("changed or has not expired")
    const sweep = dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0])
    expect(sweep.params).toEqual([TRANSFER, A, "pending", 0])
    expect(sweep.sql).toContain('"expires_at" <= clock_timestamp()')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([false, true])("cancellation rechecks caller account/session (recipient=%s)", async recipient => {
    setupCancel(recipient)
    const account = recipient ? aliAccount : ownerAccount
    mocks.user.mockResolvedValue({ ...account, clerkId: "remapped-clerk" })
    await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("cancellation access changed")
    expectNoWrites()
  })

  it.each([undefined, { ...ownerAccount, isActive: false }, { ...ownerAccount, id: ALI }])(
    "cancellation rejects missing, disabled or wrong account %s", async account => {
      setupCancel()
      mocks.user.mockResolvedValue(account)
      await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("cancellation access changed")
      expectNoWrites()
    },
  )

  it.each([false, true])("cancellation rejects suspended membership despite stale context (recipient=%s)", async recipient => {
    setupCancel(recipient)
    mocks.member.mockResolvedValue({ ...(recipient ? aliMember : ownerMember), status: "suspended" })
    await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("cancellation access changed")
    expectNoWrites()
  })

  it.each([undefined, { ...ownerMember, tenantId: OWNER }, { ...ownerMember, userId: ALI }, { ...ownerMember, role: "scorer" }])(
    "initiator cancellation rejects stale owner membership %s", async member => {
      setupCancel()
      mocks.member.mockResolvedValue(member)
      await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("cancellation access changed")
      expectNoWrites()
    },
  )

  it.each([undefined, { ...league, isActive: false }, { ...league, ownerId: ALI }, { ...league, id: OWNER }])(
    "initiator cancellation rejects changed league access %s", async currentLeague => {
      setupCancel()
      mocks.league.mockResolvedValue(currentLeague)
      await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("cancellation access changed")
      expectNoWrites()
    },
  )

  it("records the current under-lock role, not the stale context role, when declining", async () => {
    setupCancel(true)
    mocks.member.mockResolvedValue({ ...aliMember, role: "coach" })
    await cancelOwnershipTransfer(resolveKey)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ actorRole: "coach" }))
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks[0].params).toEqual([OWNER, ALI].sort())
    expect(locks[1].sql).toContain("FOR SHARE")
    expect(locks[2].params).toEqual([A, ...[OWNER, ALI].sort()])
    expect(locks[3].params).toEqual([TRANSFER, A])
    expect(mocks.user.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params)
      .toEqual([TRANSFER, A, OWNER, ALI, "pending", 0])
  })

  it("allows the active recipient to withdraw a lapsed offer without requiring the other account", async () => {
    setupCancel(true)
    mocks.transfer.mockResolvedValue({ ...pendingTransfer, expiresAt: PAST })
    await expect(cancelOwnershipTransfer(resolveKey)).resolves.toMatchObject({ success: true })
    // No authority is granted and no other account needs to be authorized.
    expect(mocks.user).toHaveBeenCalledTimes(1)
    expect(dialect.sqlToQuery(mocks.user.mock.calls[0][0].where).params).toEqual([ALI])
  })

  it("rejects a lost cancellation write without auditing success", async () => {
    setupCancel()
    mocks.updateReturning.mockResolvedValue([])
    await expect(cancelOwnershipTransfer(resolveKey)).rejects.toThrow("Transfer changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each(["initiate", "accept", "cancel"])("%s propagates audit failure without returning success", async operation => {
    if (operation === "initiate") setupInitiate()
    else if (operation === "accept") setupAccept()
    else setupCancel()
    mocks.values.mockImplementationOnce(() => {
      if (operation !== "initiate") throw new Error("Audit unavailable")
      return Object.assign(Promise.resolve(undefined), { returning: mocks.insertReturning })
    })
    if (operation === "initiate") mocks.values.mockImplementationOnce(() => { throw new Error("Audit unavailable") })
    await expect(operation === "initiate" ? initiateOwnershipTransfer(offer)
      : operation === "accept" ? acceptOwnershipTransfer(resolveKey) : cancelOwnershipTransfer(resolveKey))
      .rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("Ownership transfer initiation (first party: the recorded owner)", () => {
  it("creates a pending request with an atomic audit and never moves ownership on its own", async () => {
    setupInitiate()
    const result = await initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" })
    expect(result).toMatchObject({ success: true, transferId: TRANSFER })
    expect(mocks.insert).toHaveBeenCalledWith(ownershipTransfers)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: A, fromUserId: OWNER, toUserId: ALI, demotedRole: "team_manager", status: "pending",
    }))
    expect(mocks.insert).toHaveBeenCalledWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "OWNERSHIP_TRANSFER_INITIATE", actorId: OWNER, tenantId: A,
      payload: expect.objectContaining({ fromUserId: OWNER, toUserId: ALI }),
    }))
    // Initiation must not touch ownership or any membership.
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })

  it("refuses when the actor holds an owner role but is not the recorded owner", async () => {
    setupInitiate()
    mocks.league.mockResolvedValue({ id: A, ownerId: ALI, isActive: true })
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("recorded league owner")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses a non-owner membership even with an owner-role context", async () => {
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role: "team_manager" } })
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("refuses to offer ownership to yourself", async () => {
    setupInitiate()
    const selfMember = { ...aliMember, userId: OWNER }
    mocks.member.mockReset().mockResolvedValueOnce(selfMember).mockResolvedValueOnce(ownerMember).mockResolvedValueOnce(selfMember)
    mocks.user.mockReset().mockResolvedValueOnce(ownerAccount).mockResolvedValueOnce(ownerAccount)
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("cannot transfer ownership to yourself")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([{ role: "league_owner" }, { role: "super_admin" }])("refuses an owner/platform membership recipient %s", async changes => {
    setupInitiate()
    mocks.member.mockReset().mockResolvedValueOnce({ ...aliMember, ...changes }).mockResolvedValueOnce(ownerMember).mockResolvedValueOnce({ ...aliMember, ...changes })
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("cannot be offered")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses a recipient whose membership is suspended", async () => {
    setupInitiate()
    mocks.member.mockReset().mockResolvedValueOnce({ ...aliMember, status: "suspended" }).mockResolvedValueOnce(ownerMember).mockResolvedValueOnce({ ...aliMember, status: "suspended" })
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("not an active member")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses while a live request is already pending", async () => {
    setupInitiate()
    mocks.txLimit.mockResolvedValue([{ id: TRANSFER, expiresAt: LATER, version: 0 }])
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("already pending")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("sweeps a lapsed request to expired before opening a fresh one", async () => {
    setupInitiate()
    mocks.txLimit.mockResolvedValue([{ id: TRANSFER, expiresAt: PAST, version: 0 }])
    mocks.updateReturning.mockResolvedValueOnce([{ id: TRANSFER }])
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .resolves.toMatchObject({ success: true })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }))
    expect(mocks.insert).toHaveBeenCalledWith(ownershipTransfers)
  })

  it("rejects a stale workspace before opening a transaction", async () => {
    await expect(initiateOwnershipTransfer({ tenantId: "00000000-0000-4000-8000-0000000000ff", recipientMembershipId: ALI_MEM, demotedRole: "team_manager" }))
      .rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each(["league_owner", "super_admin", "not-a-role"])("rejects an invalid demoted role %s", async demotedRole => {
    await expect(initiateOwnershipTransfer({ tenantId: A, recipientMembershipId: ALI_MEM, demotedRole } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Ownership transfer acceptance (second party: the recipient)", () => {
  it("promotes the recipient, demotes the owner, reassigns owner_id and audits in one transaction", async () => {
    setupAccept()
    const result = await acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 })
    expect(result).toEqual({ success: true, transferId: TRANSFER, newOwnerId: ALI })
    expect(mocks.update).toHaveBeenNthCalledWith(1, userTenantRoles)
    expect(mocks.set).toHaveBeenNthCalledWith(1, { role: "league_owner", status: "active" })
    expect(mocks.set).toHaveBeenNthCalledWith(2, { role: "team_manager", status: "active" })
    expect(mocks.set).toHaveBeenNthCalledWith(3, { ownerId: ALI })
    expect(mocks.set).toHaveBeenNthCalledWith(4, expect.objectContaining({ status: "accepted", resolvedBy: ALI }))
    // The tenant is re-pointed only while it still names the outgoing owner.
    const tenantWhere = dialect.sqlToQuery(mocks.updateWhere.mock.calls[2][0]).params
    expect(tenantWhere).toEqual([A, OWNER])
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "OWNERSHIP_TRANSFER_ACCEPT", actorId: ALI, tenantId: A,
      payload: expect.objectContaining({ newOwnerId: ALI, before: expect.objectContaining({ ownerId: OWNER }),
        after: expect.objectContaining({ ownerId: ALI }) }),
    }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })

  it("locks users, then the league for update, then memberships, then the transfer", async () => {
    setupAccept()
    await acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 })
    const locks = mocks.execute.mock.calls.map(([sql]) => dialect.sqlToQuery(sql))
    expect(locks[0].params).toEqual([OWNER, ALI].sort())
    expect(locks[1].params).toEqual([A])
    expect(locks[1].sql).toContain("FOR UPDATE")
    expect(locks[2].params).toEqual([A, ...[OWNER, ALI].sort()])
    expect(locks[3].params).toEqual([TRANSFER, A])
  })

  it("refuses acceptance by anyone other than the named recipient", async () => {
    setupAccept()
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role: "league_owner" } })
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("only the named recipient")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses when the initiator is no longer the recorded owner", async () => {
    setupAccept()
    mocks.league.mockResolvedValue({ id: A, ownerId: ALI, isActive: true })
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("Ownership changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses when the outgoing owner no longer holds active owner access", async () => {
    setupAccept()
    mocks.member.mockReset().mockResolvedValueOnce({ ...ownerMember, role: "scorer" }).mockResolvedValueOnce(aliMember)
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("no longer valid")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses a stale transfer version rather than completing a superseded request", async () => {
    setupAccept()
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 5 }))
      .rejects.toThrow("Transfer changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses an expired request without a rolled-back attempt to persist expiry", async () => {
    setupAccept({ ...pendingTransfer, expiresAt: PAST })
    mocks.updateReturning.mockReset().mockResolvedValueOnce([{ id: TRANSFER }])
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("expired")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.values).not.toHaveBeenCalled()
  })

  it("refuses when the recipient membership is no longer active", async () => {
    setupAccept()
    mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValueOnce({ ...aliMember, status: "suspended" })
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("no longer active")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses a request that is not pending", async () => {
    setupAccept({ ...pendingTransfer, status: "cancelled" })
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("no longer pending")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("reports a lost conditional promotion without audit or success", async () => {
    setupAccept()
    mocks.updateReturning.mockReset().mockResolvedValueOnce([])
    await expect(acceptOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("membership changed")
    expect(mocks.values).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("rejects a stale workspace before opening a transaction", async () => {
    await expect(acceptOwnershipTransfer({ tenantId: "00000000-0000-4000-8000-0000000000ff", transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Ownership transfer cancellation", () => {
  it("lets the initiating owner rescind the offer", async () => {
    mocks.transfer.mockResolvedValueOnce(pendingTransfer).mockResolvedValueOnce(pendingTransfer)
    mocks.updateReturning.mockResolvedValueOnce([{ id: TRANSFER }])
    await expect(cancelOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .resolves.toEqual({ success: true, transferId: TRANSFER })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", resolvedBy: OWNER }))
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ method: "OWNERSHIP_TRANSFER_CANCEL",
      payload: expect.objectContaining({ cancelledBy: "initiator" }) }))
  })

  it("lets the named recipient decline the offer", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk-ali", sessionClaims: { fva: [0, 0] } })
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: ALI, role: "scorer" } })
    mocks.user.mockResolvedValue(aliAccount)
    mocks.member.mockResolvedValue(aliMember)
    mocks.transfer.mockResolvedValueOnce(pendingTransfer).mockResolvedValueOnce(pendingTransfer)
    mocks.updateReturning.mockResolvedValueOnce([{ id: TRANSFER }])
    await cancelOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 })
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ cancelledBy: "recipient" }) }))
  })

  it("refuses cancellation by an unrelated member", async () => {
    const third = "00000000-0000-4000-8000-00000000000e"
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: third, role: "scorer" } })
    mocks.transfer.mockResolvedValueOnce(pendingTransfer).mockResolvedValueOnce(pendingTransfer)
    await expect(cancelOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("only the two parties")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses to cancel a request that is already resolved", async () => {
    mocks.transfer.mockResolvedValueOnce({ ...pendingTransfer, status: "accepted" }).mockResolvedValueOnce({ ...pendingTransfer, status: "accepted" })
    await expect(cancelOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 0 }))
      .rejects.toThrow("no longer pending")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses a stale version", async () => {
    mocks.transfer.mockResolvedValueOnce(pendingTransfer).mockResolvedValueOnce(pendingTransfer)
    await expect(cancelOwnershipTransfer({ tenantId: A, transferId: TRANSFER, expectedVersion: 9 }))
      .rejects.toThrow("Transfer changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe("Ownership transfer read", () => {
  it("shows the open request to the initiator", async () => {
    mocks.limit.mockResolvedValue([{ ...pendingTransfer, fromDisplayName: "Owner", fromEmail: "o@x.com" }])
    const transfer = await getOwnershipTransfer(A)
    expect(transfer).toMatchObject({ id: TRANSFER, viewer: "initiator", toUserId: ALI })
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([A, "pending"])
  })

  it("shows the same request to the recipient as a recipient view", async () => {
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: ALI, role: "scorer" } })
    mocks.limit.mockResolvedValue([{ ...pendingTransfer, fromDisplayName: "Owner", fromEmail: "o@x.com" }])
    const transfer = await getOwnershipTransfer(A)
    expect(transfer).toMatchObject({ id: TRANSFER, viewer: "recipient", fromDisplayName: "Owner" })
  })

  it("returns null to an unrelated member instead of leaking the request", async () => {
    const third = "00000000-0000-4000-8000-00000000000e"
    mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: third, role: "scorer" } })
    mocks.limit.mockResolvedValue([pendingTransfer])
    expect(await getOwnershipTransfer(A)).toBeNull()
  })

  it("rejects a stale league assertion rather than returning another league", async () => {
    await expect(getOwnershipTransfer("00000000-0000-4000-8000-0000000000ff")).rejects.toThrow("Workspace changed")
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("requires an authenticated session", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(getOwnershipTransfer()).rejects.toThrow("Unauthorized")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
