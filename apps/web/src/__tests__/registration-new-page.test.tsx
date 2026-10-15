import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import NewRegistrationPage from "@/app/dashboard/registrations/new/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), context: vi.fn(), options: vi.fn(), form: vi.fn(() => null),
}))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
}))
vi.mock("@/lib/registration-reads", () => ({
  requireRegistrationReadContext: mocks.context,
  readRegistrationFormOptions: mocks.options,
}))
vi.mock("@/components/registrations/register-team-form", () => ({ RegisterTeamForm: mocks.form }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "team_manager" }
const options = {
  teams: [{ id: "team-1", name: "Falcons" }],
  tournaments: [{ id: TOURNAMENT, name: "Summer Cup", registrationOpen: true }],
  players: [{ id: "player-1", name: "Ali", teamId: "team-1" }],
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.form.mockImplementation(() => null)
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.context.mockResolvedValue(context)
  mocks.options.mockResolvedValue(options)
})

describe("New registration page scopes pickers to the exact active league", () => {
  it("resolves registration:create and reads the form options for that league only", async () => {
    const tree = (await NewRegistrationPage({
      searchParams: Promise.resolve({ tournamentId: TOURNAMENT }),
    })) as React.ReactElement<{ children: React.ReactElement<Record<string, unknown>> }>
    expect(mocks.context).toHaveBeenCalledWith("registration:create")
    expect(mocks.options).toHaveBeenCalledWith(TENANT)
    const form = React.Children.toArray(tree.props.children)[0] as React.ReactElement<Record<string, unknown>>
    expect(form.props.teams).toEqual(options.teams)
    expect(form.props.tournaments).toEqual(options.tournaments)
    expect(form.props.players).toEqual(options.players)
    expect(form.props.defaultTournamentId).toBe(TOURNAMENT)
  })

  it.each(["Forbidden", "Tenant not found", "Database unavailable"])(
    "propagates %s instead of redirecting an authorization failure to league setup", async (message) => {
      mocks.context.mockRejectedValue(new Error(message))
      await expect(NewRegistrationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(message)
      expect(redirects.calls).not.toContain("/dashboard/league/setup")
      expect(mocks.options).not.toHaveBeenCalled()
    })

  it("propagates a picker failure instead of rendering empty options", async () => {
    mocks.options.mockRejectedValue(new Error("Database unavailable"))
    await expect(NewRegistrationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Database unavailable")
    expect(redirects.calls).not.toContain("/dashboard/league/setup")
  })

  it("redirects an anonymous visit to the landing page before resolving context", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(NewRegistrationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/")
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
