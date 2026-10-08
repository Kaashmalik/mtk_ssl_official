"use client"

import { cn } from "../../lib/utils"

interface PointsTableEntry {
  position: number
  teamName: string
  teamLogo?: string
  played: number
  won: number
  lost: number
  tied: number
  noResult: number
  points: number
  nrr: number
  qualifiedZone?: "qualified" | "contention" | "eliminated"
}

interface PointsTableProps {
  entries: PointsTableEntry[]
  className?: string
  title?: string
}

export function PointsTable({ entries, className, title = "Points Table" }: PointsTableProps) {
  const zoneColors = {
    qualified: "bg-success/8 border-l-2 border-l-success",
    contention: "bg-warning/5 border-l-2 border-l-warning",
    eliminated: "bg-destructive/5 border-l-2 border-l-destructive/40",
  }

  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden", className)}>
      <div className="px-5 py-3 border-b">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground/70 uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left font-medium">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Team</th>
              <th className="px-4 py-2.5 text-center font-medium">P</th>
              <th className="px-4 py-2.5 text-center font-medium">W</th>
              <th className="px-4 py-2.5 text-center font-medium">L</th>
              <th className="px-4 py-2.5 text-center font-medium">T</th>
              <th className="px-4 py-2.5 text-center font-medium">NR</th>
              <th className="px-4 py-2.5 text-center font-medium">Pts</th>
              <th className="px-4 py-2.5 text-right font-medium">NRR</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.position}
                className={cn(
                  "border-t border-border/30 transition-colors hover:bg-muted/30",
                  entry.qualifiedZone && zoneColors[entry.qualifiedZone]
                )}
              >
                <td className="px-4 py-3 text-muted-foreground font-medium tabular-nums">{entry.position}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {entry.teamLogo && (
                      <img src={entry.teamLogo} alt="" className="h-5 w-5 rounded-full" />
                    )}
                    <span className="font-medium whitespace-nowrap">{entry.teamName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center tabular-nums">{entry.played}</td>
                <td className="px-4 py-3 text-center tabular-nums font-medium text-success">{entry.won}</td>
                <td className="px-4 py-3 text-center tabular-nums text-destructive">{entry.lost}</td>
                <td className="px-4 py-3 text-center tabular-nums">{entry.tied}</td>
                <td className="px-4 py-3 text-center tabular-nums">{entry.noResult}</td>
                <td className="px-4 py-3 text-center tabular-nums font-bold">{entry.points}</td>
                <td className={cn(
                  "px-4 py-3 text-right tabular-nums font-medium",
                  entry.nrr > 0 ? "text-success" : entry.nrr < 0 ? "text-destructive" : ""
                )}>
                  {entry.nrr > 0 ? "+" : ""}{entry.nrr.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Zone legend */}
      <div className="flex gap-4 px-5 py-2 border-t text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-success" />
          Qualified
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-warning" />
          In contention
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-destructive/50" />
          Eliminated
        </div>
      </div>
    </div>
  )
}
