import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userInvites } from "@mtk/database"
import { applyInvitationDeliveryEvent, extractInviteId, resendEventToState } from "@/lib/invitation-delivery"

const mocks = vi.hoisted(() => ({ update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn() }))
vi.mock("@mtk/database", async original => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { update: mocks.update },
}))

const INVITE = "00000000-0000-4000-8000-000000000004"
const dialect = new PgDialect()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.update.mockReturnValue({ set: mocks.set }); mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning }); mocks.returning.mockResolvedValue([{ id: INVITE }])
})

describe("Invitation delivery event mapping", () => {
  it.each([["email.delivered", "delivered"], ["email.bounced", "bounced"], ["email.complained", "complained"]])("maps %s to %s", (type, state) => {
    expect(resendEventToState(type)).toBe(state)
  })
  it.each(["email.sent", "email.delivery_delayed", "email.opened", "email.clicked", "", "unknown"])("ignores %s", type => {
    expect(resendEventToState(type)).toBeNull()
  })
  it("extracts a UUID invite tag and rejects anything else", () => {
    expect(extractInviteId({ tags: [{ name: "invite_id", value: INVITE }] })).toBe(INVITE)
    expect(extractInviteId({ tags: [{ name: "other", value: INVITE }] })).toBeNull()
    expect(extractInviteId({ tags: [{ name: "invite_id", value: "not-a-uuid" }] })).toBeNull()
    expect(extractInviteId({ tags: [{ name: "invite_id" }] })).toBeNull()
    expect(extractInviteId({ tags: "nope" })).toBeNull()
    expect(extractInviteId(null)).toBeNull()
    expect(extractInviteId({})).toBeNull()
  })
})

describe("Applying a verified delivery event", () => {
  it("persists the mapped state for the tagged invitation", async () => {
    const result = await applyInvitationDeliveryEvent({ type: "email.bounced", data: { tags: [{ name: "invite_id", value: INVITE }] } })
    expect(result).toEqual({ applied: true, inviteId: INVITE, state: "bounced" })
    expect(mocks.update).toHaveBeenCalledWith(userInvites)
    expect(mocks.set).toHaveBeenCalledWith({ emailState: "bounced" })
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([INVITE])
  })
  it("ignores unmapped events without touching the database", async () => {
    expect(await applyInvitationDeliveryEvent({ type: "email.opened", data: { tags: [{ name: "invite_id", value: INVITE }] } }))
      .toEqual({ applied: false, inviteId: null, state: null })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("ignores a mapped event with no correlatable invitation", async () => {
    expect(await applyInvitationDeliveryEvent({ type: "email.delivered", data: { tags: [] } }))
      .toEqual({ applied: false, inviteId: null, state: "delivered" })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("reports not-applied for an unknown invitation without throwing", async () => {
    mocks.returning.mockResolvedValue([])
    expect(await applyInvitationDeliveryEvent({ type: "email.delivered", data: { tags: [{ name: "invite_id", value: INVITE }] } }))
      .toEqual({ applied: false, inviteId: INVITE, state: "delivered" })
  })
})
