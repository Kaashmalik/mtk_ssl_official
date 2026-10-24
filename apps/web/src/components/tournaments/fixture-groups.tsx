import { Calendar } from "lucide-react"
import { Badge } from "@mtk/ui/components/ui/badge"
import Link from "next/link"
import type { FixtureGroup } from "@/lib/fixture-groups"

/**
 * Batch 129: the fixtures card reads LIVE → Upcoming → Results, each
 * section headed with its truthful count (the live section carries a
 * pulsing red dot). Rows keep the EXACT markup the flat list used — same
 * link, same per-item status badge — only the reading order changes.
 */

const SECTION_LABELS = {
  live: "Live now",
  upcoming: "Upcoming",
  results: "Results",
} as const

export type FixtureRowData = {
  id: string
  status: string
  dateText: string
  teamAName: string
  teamAScore?: string | null
  teamBName: string
  teamBScore?: string | null
  result?: string | null
}

function FixtureRow({ m }: { m: FixtureRowData }) {
  return (
    <Link href={`/matches/${m.id}`} className="block rounded-lg border p-3 hover:bg-muted/40">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{m.dateText}</span>
        <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium">{m.teamAName}</span>
        <span className="tabular-nums font-semibold">{m.teamAScore || "-"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium">{m.teamBName}</span>
        <span className="tabular-nums font-semibold">{m.teamBScore || "-"}</span>
      </div>
      {m.result && <p className="text-xs text-muted-foreground mt-1">{m.result}</p>}
    </Link>
  )
}

export function FixtureGroups({ groups }: { groups: FixtureGroup<FixtureRowData>[] }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={SECTION_LABELS[group.key]}>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-2">
            {group.key === "live" && (
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
            )}
            {SECTION_LABELS[group.key]}
            <span className="text-xs font-normal text-muted-foreground">({group.count})</span>
          </h3>
          <div className="space-y-3">
            {group.matches.map((m) => <FixtureRow key={m.id} m={m} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
