import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui"
import { Flame, Target } from "lucide-react"
import type { MilestoneEntry } from "@mtk/database/lib/milestone-policy"
import type { PublicMilestones } from "@/lib/public-visibility"

/**
 * FAN-03 milestone cards on the PUBLIC tournament page. Every entry is a
 * derived fact replayed from an official scorecard row through the
 * publication gate; the section renders the evidence value (runs/wickets)
 * verbatim and never fabricates an entry to fill the space.
 */

export const MILESTONE_LABELS = {
  title: "Tournament Milestones",
  centuries: "Centuries",
  fiveFors: "Five-wicket hauls",
  empty: "No centuries or five-fors recorded yet - milestones appear when official scorecards earn them.",
  verified: "Verified player",
  unverified: "Unverified record",
  engagementNote: "Milestones are celebration surfaces - they feed no official decision.",
} as const

export function milestoneLine(entry: MilestoneEntry, kind: "century" | "fiveFor"): string {
  return kind === "century" ? `${entry.playerName} - ${entry.value} runs` : `${entry.playerName} - ${entry.value} wickets`
}

export function MilestoneCards({ milestones }: { milestones: PublicMilestones }) {
  const hasAny = milestones.centuries.length > 0 || milestones.fiveFors.length > 0
  if (!hasAny) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">{MILESTONE_LABELS.empty}</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{MILESTONE_LABELS.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {milestones.centuries.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
              {MILESTONE_LABELS.centuries}
            </p>
            <ul className="text-sm text-muted-foreground space-y-1" aria-label={MILESTONE_LABELS.centuries}>
              {milestones.centuries.map(entry => (
                <li key={`century-${entry.playerId}-${entry.value}-${entry.recordedAt}`}>
                  {milestoneLine(entry, "century")}
                  <span className="sr-only">{entry.playerVerified ? MILESTONE_LABELS.verified : MILESTONE_LABELS.unverified}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {milestones.fiveFors.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-sky-600" aria-hidden="true" />
              {MILESTONE_LABELS.fiveFors}
            </p>
            <ul className="text-sm text-muted-foreground space-y-1" aria-label={MILESTONE_LABELS.fiveFors}>
              {milestones.fiveFors.map(entry => (
                <li key={`fivefor-${entry.playerId}-${entry.value}-${entry.recordedAt}`}>
                  {milestoneLine(entry, "fiveFor")}
                  <span className="sr-only">{entry.playerVerified ? MILESTONE_LABELS.verified : MILESTONE_LABELS.unverified}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{MILESTONE_LABELS.engagementNote}</p>
      </CardContent>
    </Card>
  )
}
