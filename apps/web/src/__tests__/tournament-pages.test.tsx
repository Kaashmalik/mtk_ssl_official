import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TournamentsPage from "@/app/dashboard/tournaments/page"
import NewTournamentPage from "@/app/dashboard/tournaments/new/page"
import { NewTournamentForm } from "@/components/tournaments/new-tournament-form"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), list: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.context }))
vi.mock("@/lib/tournament-reads", () => ({ readTournamentList: mocks.list, tournamentListLimit: 200 }))
vi.mock("@/components/tournaments/new-tournament-form", () => ({ NewTournamentForm: () => null }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" }
const tournament = { id: "00000000-0000-4000-8000-000000000002", tenantId: TENANT, name: "Summer Cup",
  status: "registration", format: "league", startDate: null, description: null,
  registeredTeams: 4, totalMatches: 6, completedMatches: 3 }

function elements(node: any): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node as React.ReactElement<any>, ...elements((node.props as any).children)]
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as any).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}
function links(node: any) { return elements(node).map(element => element.props.href).filter(Boolean) }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(context)
  mocks.list.mockResolvedValue({ truncated: false, tournaments: [tournament] })
})

describe("Tournaments list page requires exact-league authority", () => {
  it("resolves tournament:read before reading and passes the resolved league", async () => {
    const tree = await TournamentsPage()
    expect(mocks.context).toHaveBeenCalledWith("tournament:read")
    expect(mocks.list).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("Summer Cup")
    expect(links(tree)).toContain("/dashboard/tournaments/new")
  })
  it.each(["Forbidden", "Tenant not found", "Database unavailable"])("propagates %s without a setup redirect or fake empty list", async (message) => {
    mocks.context.mockRejectedValue(new Error(message))
    await expect(TournamentsPage()).rejects.toThrow(message)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it("propagates a list failure instead of rendering an empty state", async () => {
    mocks.list.mockRejectedValue(new Error("Database unavailable"))
    await expect(TournamentsPage()).rejects.toThrow("Database unavailable")
  })
  it("explains a truncated list rather than silently dropping tournaments", async () => {
    mocks.list.mockResolvedValue({ truncated: true, tournaments: [tournament] })
    expect(text(await TournamentsPage())).toContain("Showing the first")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(TournamentsPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("New tournament page requires exact-league authority", () => {
  it("resolves tournament:create before rendering the creator", async () => {
    const tree = await NewTournamentPage()
    expect(mocks.context).toHaveBeenCalledWith("tournament:create")
    expect(elements(tree).some(element => element.type === NewTournamentForm)).toBe(true)
  })
  it("propagates a denied or failed context without a setup redirect", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(NewTournamentPage()).rejects.toThrow("Forbidden")
  })
  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(NewTournamentPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
