import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 122: SportsEvent structured data — the schema.org type Google's
 * sports rich results actually read. Same discipline as the other structured
 * data: built ONLY from already-gated reads, optional fields omitted when
 * unknown (never "TBD" placeholders), cancelled competitions labelled
 * EventCancelled, and a missing name means NO event is emitted.
 */
afterEach(() => vi.resetModules())

describe("SportsEvent structured data (Batch 122)", () => {
  async function load() {
    vi.resetModules()
    return import("../lib/sports-event-structured-data")
  }

  it("a published tournament becomes a SportsEvent with mapped status and no fabricated location", async () => {
    const { buildTournamentSportsEvent } = await load()
    const data = buildTournamentSportsEvent({
      name: "Falcon Cup", status: "live", startDate: "2026-09-01", endDate: "2026-10-30", description: "Annual invitational",
    }) as unknown as Record<string, any>
    expect(data["@type"]).toBe("SportsEvent")
    expect(data.name).toBe("Falcon Cup")
    expect(data.eventStatus).toBe("https://schema.org/EventScheduled")
    expect(data.startDate).toBe("2026-09-01")
    expect(data.endDate).toBe("2026-10-30")
    expect(data.description).toBe("Annual invitational")
    expect(data.location).toBeUndefined()
  })

  it("a cancelled tournament maps to EventCancelled; absent dates are omitted, never invented", async () => {
    const { buildTournamentSportsEvent } = await load()
    const data = buildTournamentSportsEvent({
      name: "Old Cup", status: "cancelled", startDate: null, endDate: "2026-10-30", description: null,
    }) as unknown as Record<string, any>
    expect(data.eventStatus).toBe("https://schema.org/EventCancelled")
    expect(data.startDate).toBeUndefined()
    expect(data.endDate).toBe("2026-10-30")
    expect(data.description).toBeUndefined()
  })

  it("a published match becomes a SportsEvent with both competitors and a real venue location", async () => {
    const { buildMatchSportsEvent } = await load()
    const data = buildMatchSportsEvent({
      heading: "Falcons vs Tigers", scheduledDate: "2026-10-01", status: "live",
      venue: "National Stadium, Karachi", teamAName: "Falcons", teamBName: "Tigers",
    }) as unknown as Record<string, any>
    expect(data["@type"]).toBe("SportsEvent")
    expect(data.name).toBe("Falcons vs Tigers")
    expect(data.startDate).toBe("2026-10-01")
    expect(data.location).toEqual({ "@type": "Place", name: "National Stadium, Karachi" })
    expect(data.competitor).toEqual([
      { "@type": "SportsTeam", name: "Falcons" },
      { "@type": "SportsTeam", name: "Tigers" },
    ])
  })

  it("a match without a venue or a resolvable date omits them; a hidden match yields nothing", async () => {
    const { buildMatchSportsEvent } = await load()
    const data = buildMatchSportsEvent({
      heading: "Falcons vs Tigers", scheduledDate: null, status: "completed",
      venue: null, teamAName: "Falcons", teamBName: "Tigers",
    }) as unknown as Record<string, any>
    expect(data.location).toBeUndefined()
    expect(data.startDate).toBeUndefined()
    expect(data.eventStatus).toBe("https://schema.org/EventScheduled")
    expect(buildMatchSportsEvent({
      heading: "Falcons vs Tigers", scheduledDate: null, status: "completed",
      venue: null, teamAName: null, teamBName: "Tigers",
    })).toBeNull()
  })
})
