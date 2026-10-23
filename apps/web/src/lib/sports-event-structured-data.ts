/**
 * Batch 122: SportsEvent structured data for the two public detail surfaces —
 * the schema.org type sports rich results actually read. The same discipline
 * as the hub ItemList (Batch 118): the builders invent nothing, omit what
 * the gated reads did not provide (never "TBD" placeholders), and emit
 * nothing at all when a surface is not really an event.
 */

const EVENT_SCHEDULED = "https://schema.org/EventScheduled"
const EVENT_CANCELLED = "https://schema.org/EventCancelled"

type TournamentEventInput = {
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  description: string | null
}

/** A tournament is one competition; its venue set is not knowable here, so
 * no location is ever fabricated. */
export function buildTournamentSportsEvent(tournament: TournamentEventInput | null): object | null {
  if (!tournament || !tournament.name) return null
  const event: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: tournament.name,
    eventStatus: tournament.status === "cancelled" ? EVENT_CANCELLED : EVENT_SCHEDULED,
  }
  if (tournament.startDate) event.startDate = tournament.startDate
  if (tournament.endDate) event.endDate = tournament.endDate
  if (tournament.description) event.description = tournament.description
  return event
}

type MatchEventInput = {
  heading: string
  scheduledDate: string | null
  status: string
  /** The verified venue string ("Name, City") — null when the match has no venue. */
  venue: string | null
  teamAName: string | null
  teamBName: string | null
}

/** A published match is a SportsEvent with both competitors; a hidden or
 * half-resolved match yields null and the page renders no script. */
export function buildMatchSportsEvent(match: MatchEventInput): object | null {
  if (!match.heading || !match.teamAName || !match.teamBName) return null
  const event: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: match.heading,
    eventStatus: match.status === "cancelled" ? EVENT_CANCELLED : EVENT_SCHEDULED,
    competitor: [
      { "@type": "SportsTeam", name: match.teamAName },
      { "@type": "SportsTeam", name: match.teamBName },
    ],
  }
  if (match.scheduledDate) event.startDate = match.scheduledDate
  if (match.venue) event.location = { "@type": "Place", name: match.venue }
  return event
}
