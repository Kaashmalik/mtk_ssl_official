import React from "react"
import { formatNetRunRate, type computeGroupStandings } from "@/lib/standings"

/**
 * Batch 138 (standings sweep): the public tournament page shows TWO
 * standings presentations of the SAME engine output, and they did not look
 * related — the group tables shipped a different header vocabulary, no
 * tabular numerals, no long-name containment, no row separators, no
 * emphasis. They now speak the Points Table's language (compact, expanded
 * via title attributes) while KEEPING what the group table did better:
 * the scope attributes, the caption, the disclosure — and the NRR honesty
 * both tables already share (formatted only with complete innings
 * evidence, an honest em-dash until then).
 *
 * Presentation only: rows arrive already ranked by the versioned standings
 * engine; the position column renders that order as 1..N — it is the
 * table's order, nothing is re-sorted or re-computed here.
 */

const GROUP_HEADERS: { short: string; title: string }[] = [
  { short: "Team", title: "Team" },
  { short: "P", title: "Played" },
  { short: "W", title: "Won" },
  { short: "L", title: "Lost" },
  { short: "Pts", title: "Points" },
  { short: "NRR", title: "Net run rate" },
]

export function GroupStandings({
  groups,
  qualifyingTeamIds = [],
  qualificationRuleSummary = null,
}: {
  groups: ReturnType<typeof computeGroupStandings>
  /** Batch 146: engine-ordered qualifying ids (per-group slices); absent → no markers, no legend. */
  qualifyingTeamIds?: string[] | null
  /** Verbatim restatement of the league organizer's rule. */
  qualificationRuleSummary?: string | null
}) {
  if (groups.length === 0) return null
  return <section aria-label="Group standings" className="space-y-4">
    <h2 className="text-lg font-semibold">Group standings</h2>
    <p className="text-sm text-muted-foreground">Fixtures with a recorded group count toward that group&apos;s table. Unlabelled fixtures stay in the tournament-wide table below.</p>
    {groups.map(group =>
      <div key={group.label} className="overflow-x-auto rounded-lg border p-3">
        <table className="w-full text-sm">
          <caption className="text-start font-semibold pb-2">Group {group.label}</caption>
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              {GROUP_HEADERS.map(({ short, title }) =>
                <th key={short} scope="col" title={title} className="p-2 font-medium text-center first:text-start last:text-end">{short}</th>,
              )}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, position) =>
              <tr key={row.teamId} className="border-b last:border-0">
                <td className="p-2 text-center tabular-nums text-muted-foreground" aria-label={`Position ${position + 1}`}>{position + 1}</td>
                <th scope="row" className="text-start p-2 font-medium max-w-[10rem] truncate" title={row.name}>
                  {row.name}
                  {qualifyingTeamIds?.includes(row.teamId) && (
                    <span
                      className="ml-1.5 text-[10px] font-bold text-primary align-middle"
                      aria-label="Qualification position"
                      title="Qualification position"
                    >
                      Q
                    </span>
                  )}
                </th>
                <td className="p-2 text-center tabular-nums">{row.played}</td>
                <td className="p-2 text-center tabular-nums">{row.won}</td>
                <td className="p-2 text-center tabular-nums">{row.lost}</td>
                <td className="p-2 text-center font-semibold tabular-nums">{row.points}</td>
                <td className="p-2 text-end tabular-nums">{row.hasNetRunRate ? formatNetRunRate(row.netRunRate) : "—"}</td>
              </tr>,
            )}
          </tbody>
        </table>
      </div>,
    )}
    {/* Batch 146: the organizer's rule restated verbatim, once, attributed
        to the organizer — rendered only when they set a rule. */}
    {qualificationRuleSummary && (
      <p className="text-xs text-muted-foreground" aria-label="Qualification rule">
        {qualificationRuleSummary}
      </p>
    )}
  </section>
}
