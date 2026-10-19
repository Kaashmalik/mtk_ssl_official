import React from "react"
import { formatNetRunRate, type computeGroupStandings } from "@/lib/standings"

export function GroupStandings({ groups }: { groups: ReturnType<typeof computeGroupStandings> }) {
  if (groups.length === 0) return null
  return <section aria-label="Group standings" className="space-y-4">
    <h2 className="text-lg font-semibold">Group standings</h2>
    <p className="text-sm text-muted-foreground">Fixtures with a recorded group count toward that group&apos;s table. Unlabelled fixtures stay in the tournament-wide table below.</p>
    {groups.map(group => <div key={group.label} className="overflow-x-auto rounded-lg border p-3">
      <table className="w-full text-sm">
        <caption className="text-start font-semibold pb-2">Group {group.label}</caption>
        <thead><tr>{["Team", "Played", "Won", "Lost", "Points", "NRR"].map(label => <th key={label} scope="col" className="text-start p-2">{label}</th>)}</tr></thead>
        <tbody>{group.rows.map(row => <tr key={row.teamId}>
          <th scope="row" className="text-start p-2">{row.name}</th>
          <td className="p-2">{row.played}</td><td className="p-2">{row.won}</td><td className="p-2">{row.lost}</td>
          <td className="p-2">{row.points}</td><td className="p-2">{row.hasNetRunRate ? formatNetRunRate(row.netRunRate) : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
  </section>
}
