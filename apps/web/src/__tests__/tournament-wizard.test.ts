import { describe, expect, it } from "vitest"
import { createFormControl } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { TOURNAMENT_STEP_FIELDS, tournamentWizardSchema, type TournamentFormData } from "@/lib/tournament-wizard"
import { tournamentWizardToInput, tournamentToWizardDefaults, reconcileSlotOrder } from "@/lib/tournament-wizard"
import { readPrizePool, readTournamentConfiguration } from "@mtk/database/lib/tournament-configuration"

function createWizardForm() {
  const form = createFormControl<TournamentFormData>({
    resolver: zodResolver(tournamentWizardSchema),
    defaultValues: {
      name: "",
      description: "",
      startDate: "",
      endDate: "",
      location: "",
      maxTeams: 8,
      registrationFee: 0,
      prizePool: 0,
      teamSeeding: [],
      logo: "",
      primaryColor: "#10b981",
    },
  })
  for (const field of new Set(TOURNAMENT_STEP_FIELDS.flat())) form.register(field)
  return form
}

describe("Tournament wizard step validation", () => {
  it("allows choosing a format before required later-step fields are filled", async () => {
    const form = createWizardForm()
    form.setValue("format", "league")

    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[0]])).toBe(true)
    expect(await form.trigger()).toBe(false)
  })

  it("blocks progression when the current step is incomplete", async () => {
    const form = createWizardForm()
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[0]])).toBe(false)
    form.setValue("format", "knockout")
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[1]])).toBe(false)
    form.setValue("matchType", "t20")
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[1]])).toBe(true)
  })

  it("validates details and registration independently of unfilled later fields", async () => {
    const form = createWizardForm()
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[2]])).toBe(false)
    form.setValue("name", "Premium League")
    form.setValue("location", "Lahore")
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[2]])).toBe(true)

    form.setValue("maxTeams", 1)
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[3]])).toBe(false)
    form.setValue("maxTeams", 8)
    form.setValue("registrationFee", -1)
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[3]])).toBe(false)
  })

  it("requires the entire form to be valid on final submission", async () => {
    const form = createWizardForm()
    form.setValue("format", "hybrid")
    form.setValue("matchType", "custom")
    form.setValue("customOvers", 10)
    form.setValue("name", "Premium League")
    form.setValue("location", "Lahore")
    expect(await form.trigger()).toBe(true)

    form.setValue("name", "")
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[6]])).toBe(true)
    expect(await form.trigger()).toBe(false)
  })

  it.each(["custom", "tape_ball"] as const)("requires overs for %s before later steps are filled", async (matchType) => {
    const form = createWizardForm()
    form.setValue("matchType", matchType)
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[1]])).toBe(false)
    form.setValue("customOvers", 10)
    expect(await form.trigger([...TOURNAMENT_STEP_FIELDS[1]])).toBe(true)
  })
})

function completeForm(): TournamentFormData {
  return { name: "  Premium League  ", format: "knockout", matchType: "custom", customOvers: 12,
    startDate: "2026-11-01", endDate: "2026-11-03", location: "Lahore", maxTeams: 4,
    registrationFee: 19.99, prizePool: 25000.50, teamSeeding: ["team-3", "team-1", "team-4", "team-2"],
    logo: "https://cdn.example.com/logo.png", primaryColor: "#123abc" }
}

describe("Wizard persistence and template round-trip", () => {
  it("maps every collected setting into the create action contract", () => {
    expect(tournamentWizardToInput(completeForm())).toMatchObject({ name: "Premium League", maxTeams: 4,
      registrationFee: 19.99, prizeAmount: 25000.50,
      configuration: { version: 1, matchType: "custom", overs: 12, location: "Lahore", seedOrder: [3, 1, 4, 2],
        branding: { logo: "https://cdn.example.com/logo.png", primaryColor: "#123abc" } } })
  })
  it("copies saved settings but never old identity, dates, or registration state", () => {
    const input = tournamentWizardToInput(completeForm())
    const defaults = tournamentToWizardDefaults({ format: input.format, description: "Old description", maxTeams: 4,
      rules: { wizard: input.configuration }, entryFee: "19.99", prizePool: { version: 1, total: "25000.50" } })
    expect(defaults).toMatchObject({ matchType: "custom", customOvers: 12, location: "Lahore", registrationFee: 19.99,
      prizePool: 25000.50, teamSeeding: ["team-3", "team-1", "team-4", "team-2"], primaryColor: "#123abc" })
    for (const key of ["name", "startDate", "endDate", "id", "tenantId", "registrationOpen"]) expect(defaults).not.toHaveProperty(key)
  })
  it("uses safe defaults for old/corrupt templates instead of trusting unknown JSON", () => {
    const defaults = tournamentToWizardDefaults({ format: "round_robin", description: null, maxTeams: 128,
      rules: { wizard: { version: 999, matchType: "custom", primaryColor: "javascript" } }, entryFee: "NaN", prizePool: { winner: 1000 } })
    expect(defaults).toMatchObject({ format: "league", maxTeams: 64, registrationFee: 0, prizePool: 0,
      teamSeeding: [], primaryColor: "#10b981", logo: "", location: "" })
  })
  it.each([
    { endDate: "2026-10-01" }, { startDate: "2026-02-29" }, { maxTeams: 4.5 },
    { customOvers: 3.5 }, { registrationFee: 1.001 }, { prizePool: -1 },
    { teamSeeding: ["team-1", "team-1", "team-3", "team-4"] }, { teamSeeding: ["foreign-uuid"] },
    { primaryColor: "blue" }, { logo: "javascript:alert(1)" },
  ])("rejects invalid wizard data %s", (change) => {
    expect(tournamentWizardSchema.safeParse({ ...completeForm(), ...change }).success).toBe(false)
  })
  it("uses standard overs and a complete default slot order when no reordering is supplied", () => {
    const data = tournamentWizardToInput({ ...completeForm(), matchType: "t20", teamSeeding: [] })
    expect(data.configuration).toMatchObject({ overs: 20, seedOrder: [1, 2, 3, 4] })
    expect(readTournamentConfiguration({ wizard: data.configuration })).not.toBeNull()
    expect(readPrizePool({ version: 1, total: "0.00" })).toBe("0.00")
  })
  it("keeps stable slot labels and adjusts capacity without duplicating slots", () => {
    expect(reconcileSlotOrder(["team-3", "team-1", "team-2", "team-4"], 2)).toEqual(["team-1", "team-2"])
    expect(reconcileSlotOrder(["team-2", "team-1", "team-1"], 4)).toEqual(["team-2", "team-1", "team-3", "team-4"])
  })
})
