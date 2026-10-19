import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { FORM_GUIDE_DISCLOSURE, FORM_GUIDE_RULE_VERSION, type FormGuideRow } from "@/lib/form-guide"

/**
 * FAN-03 (Batch 165): the approved form-guide analytic package. A
 * server-rendered, read-only table: derived form letters, streaks and
 * W/L/no-verdict counts over the official published result set, labeled
 * derived with the disclosure ALWAYS attached. No prediction, no odds, no
 * editorial voice - an unplayed match contributes nothing by construction.
 */
export function FormGuide({ rows }: { rows: FormGuideRow[] }) {
  if (rows.length === 0) {
    return (
      <Card data-testid="form-guide" data-rule-version={FORM_GUIDE_RULE_VERSION}>
        <CardHeader>
          <CardTitle className="text-lg">Form guide</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No form to show yet: no official results have been recorded in this competition.
          </p>
        </CardContent>
      </Card>
    )
  }

  const letterChip = (letter: "W" | "L" | "N") => {
    if (letter === "W") return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-green-600 text-xs font-bold text-white">W</span>
    if (letter === "L") return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-600 text-xs font-bold text-white">L</span>
    return <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">N</span>
  }

  const streakLine = (row: FormGuideRow) => {
    if (!row.streak) return "No streak"
    if (row.streak.letter === "W") return `W${row.streak.length} streak`
    if (row.streak.letter === "L") return `L${row.streak.length} slump`
    return `Last ${row.streak.length} without a W/L verdict`
  }

  return (
    <Card data-testid="form-guide" data-rule-version={FORM_GUIDE_RULE_VERSION}>
      <CardHeader>
        <CardTitle className="text-lg">Form guide</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Team</th>
                <th className="py-2 pr-3 font-medium">Last {rows[0]?.sequence.length ?? 5}</th>
                <th className="py-2 pr-3 font-medium">P</th>
                <th className="py-2 pr-3 font-medium">W</th>
                <th className="py-2 pr-3 font-medium">L</th>
                <th className="py-2 pr-3 font-medium">N</th>
                <th className="py-2 font-medium">Streak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teamId} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.teamName}</td>
                  <td className="py-2 pr-3">
                    <span className="flex gap-1">
                      {row.sequence.map((entry) => (
                        <span key={entry.matchId} title={entry.resultText ?? entry.opponentName}>
                          {letterChip(entry.letter)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{row.played}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.won}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.lost}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.noVerdict}</td>
                  <td className="py-2 text-xs text-muted-foreground">{streakLine(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{FORM_GUIDE_DISCLOSURE}</p>
      </CardContent>
    </Card>
  )
}
