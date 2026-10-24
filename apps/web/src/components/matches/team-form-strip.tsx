import * as React from "react"
import { FORM_GUIDE_DISCLOSURE, type FormGuideRow } from "@/lib/form-guide"

/**
 * Batch 135: the match centre names two teams and says nothing about what
 * either has been doing. This strip reuses the APPROVED form-guide engine
 * (computeFormGuide output — derived ONLY from official published results,
 * rule-versioned, no prediction, no editorial voice) and presents one
 * team's form: letter chips most-recent-first, truthful counts, a streak
 * line sized exactly as the data says, and the disclosure ALWAYS attached
 * (an unplayed team gets an honest line instead of fabricated zeros).
 */

function letterChip(letter: "W" | "L" | "N"): React.ReactElement {
  if (letter === "W") return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-green-600 text-xs font-bold text-white">W</span>
  if (letter === "L") return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-600 text-xs font-bold text-white">L</span>
  return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">N</span>
}

export function TeamFormStrip({ row }: { row: FormGuideRow | null }) {
  if (!row || row.sequence.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        <p>No completed matches yet — form appears once official results are in.</p>
        <p className="mt-0.5">{FORM_GUIDE_DISCLOSURE}</p>
      </div>
    )
  }

  const { won, lost, noVerdict, streak } = row
  const streakLabel =
    streak === null ? null
    : streak.letter === "W" ? `Won last ${streak.length}`
    : streak.letter === "L" ? `Lost last ${streak.length}`
    : null // a no-verdict streak is shown by the counts, not dramatized

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1" aria-hidden="true">
          {row.sequence.map((entry) => <React.Fragment key={entry.matchId}>{letterChip(entry.letter)}</React.Fragment>)}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{won}W · {lost}L{noVerdict > 0 ? ` · ${noVerdict}N` : ""}</span>
        {streakLabel && <span className="text-xs font-medium">{streakLabel}</span>}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{FORM_GUIDE_DISCLOSURE}</p>
    </div>
  )
}
