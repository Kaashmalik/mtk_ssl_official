import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import VenuesPage from "@/app/dashboard/venues/page"
import NewVenuePage from "@/app/dashboard/venues/new/page"
import EditVenuePage from "@/app/dashboard/venues/[id]/edit/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), list: vi.fn(), readVenue: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("notFound") },
}))
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))
vi.mock("@/lib/venue-reads", () => ({
  requireVenueReadContext: mocks.context,
  readVenueList: mocks.list,
  readVenue: mocks.readVenue,
}))
vi.mock("@/components/venues/venue-form", () => ({ VenueForm: () => null }))
vi.mock("@/components/venues/venue-row-actions", () => ({ VenueRowActions: () => null }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const VENUE = "00000000-0000-4000-8000-000000000002"
const owner = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" }
const fan = { ...owner, role: "fan" }
const venueRow = {
  id: VENUE, tenantId: TENANT, name: "Gaddafi Stadium", address: null, city: "Lahore",
  state: null, country: "Pakistan", capacity: 25000, groundType: "grass", isActive: true,
  createdAt: new Date(), updatedAt: new Date(),
}

function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(" ")
  if (React.isValidElement(node)) return text((node.props as any).children)
  return typeof node === "string" || typeof node === "number" ? String(node) : ""
}

function links(node: any): string[] {
  if (Array.isArray(node)) return node.flatMap(links)
  if (React.isValidElement(node)) {
    const href = (node.props as any)?.href
    return [...(typeof href === "string" ? [href] : []), ...links((node.props as any)?.children)]
  }
  return []
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(owner)
  mocks.list.mockResolvedValue({ truncated: false, venues: [venueRow] })
  mocks.readVenue.mockResolvedValue(venueRow)
})

describe("Venues page requires exact-league authority", () => {
  it("resolves venue:read, reads only the resolved league and renders its venues", async () => {
    const tree = await VenuesPage()
    expect(mocks.context).toHaveBeenCalledWith("venue:read")
    expect(mocks.list).toHaveBeenCalledWith(TENANT)
    expect(text(tree)).toContain("Gaddafi Stadium")
  })

  it("offers create and edit controls to a league owner", async () => {
    const hrefs = links(await VenuesPage())
    expect(hrefs).toContain("/dashboard/venues/new")
    expect(hrefs).toContain(`/dashboard/venues/${VENUE}/edit`)
  })

  it("withholds create and edit controls from a read-only member", async () => {
    mocks.context.mockResolvedValue(fan)
    const hrefs = links(await VenuesPage())
    expect(hrefs).not.toContain("/dashboard/venues/new")
    expect(hrefs).not.toContain(`/dashboard/venues/${VENUE}/edit`)
  })

  it.each(["Forbidden", "Tenant not found", "Database unavailable"])(
    "propagates %s instead of rendering a fake empty list", async (message) => {
      mocks.context.mockRejectedValue(new Error(message))
      await expect(VenuesPage()).rejects.toThrow(message)
      expect(mocks.list).not.toHaveBeenCalled()
    })

  it("propagates a read failure instead of rendering an empty list", async () => {
    mocks.list.mockRejectedValue(new Error("Database unavailable"))
    await expect(VenuesPage()).rejects.toThrow("Database unavailable")
  })

  it("redirects anonymous visits before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(VenuesPage()).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})

describe("New venue page requires exact-league authority", () => {
  it("resolves venue:manage for the exact active league", async () => {
    await NewVenuePage()
    expect(mocks.context).toHaveBeenCalledWith("venue:manage")
  })

  it("propagates a denied context without falling back to another league", async () => {
    mocks.context.mockRejectedValue(new Error("Forbidden"))
    await expect(NewVenuePage()).rejects.toThrow("Forbidden")
  })
})

describe("Edit venue page requires exact-league authority", () => {
  const params = Promise.resolve({ id: VENUE })

  it("resolves venue:manage and reads the venue scoped to the resolved league", async () => {
    await EditVenuePage({ params })
    expect(mocks.context).toHaveBeenCalledWith("venue:manage")
    expect(mocks.readVenue).toHaveBeenCalledWith(TENANT, VENUE)
  })

  it("404s a missing or foreign-league venue rather than rendering it", async () => {
    mocks.readVenue.mockResolvedValue(null)
    await expect(EditVenuePage({ params })).rejects.toThrow("notFound")
  })
})
