import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedMatch, readPublishedMatchTeams } from "@/lib/public-visibility"

/**
 * Batch 119: render data for the match-centre OG share card. The claims are
 * resolved through the SAME publication gates as the page and the metadata
 * (Batch 114): anything unpublished, foreign, half-resolved, or erroring is
 * `null` — a hidden match must never have a shareable image. Accent colors
 * are re-validated here as strict hex even though the visibility read bounds
 * the columns: a canvas draws whatever it is handed, so the guard lives at
 * the draw boundary. Invalid/absent colors fall back to the platform
 * palette, never to a raw column value.
 */
export const PLATFORM_ACCENT_A = "#1e40af"
export const PLATFORM_ACCENT_B = "#0f766e"

export type MatchOgRenderData = {
  heading: string
  subLine: string
  accentA: string
  accentB: string
}

function hexColor(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && /^#[\da-fA-F]{6}$/.test(value) ? value : fallback
}

export async function resolveMatchOgRenderData(matchId: string): Promise<MatchOgRenderData | null> {
  try {
    const tenantId = await requirePublicTenantId()
    const match = await readPublishedMatch(tenantId, matchId)
    if (!match) return null
    const { teamA, teamB } = await readPublishedMatchTeams(tenantId, match)
    if (!teamA || !teamB) return null

    const facts = [match.result, match.matchFormat, match.scheduledDate]
      .filter(fact => typeof fact === "string" || typeof fact === "number")
      .map(fact => String(fact))
      .filter(fact => fact.length > 0)

    return {
      heading: `${teamA.name} vs ${teamB.name}`,
      subLine: facts.join(" · ") || "Match centre",
      accentA: hexColor(teamA.primaryColor, PLATFORM_ACCENT_A),
      accentB: hexColor(teamB.primaryColor, PLATFORM_ACCENT_B),
    }
  } catch {
    return null
  }
}
