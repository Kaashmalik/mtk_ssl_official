import { describe, expect, it } from "vitest"
import { createFormControl } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { TOURNAMENT_STEP_FIELDS, tournamentWizardSchema, type TournamentFormData } from "@/lib/tournament-wizard"

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
})
