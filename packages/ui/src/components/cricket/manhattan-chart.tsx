"use client"

import { cn } from "../../lib/utils"
import { motion } from "framer-motion"

interface OverData {
  overNumber: number
  runs: number
  wickets: number
  extras: number
}

interface ManhattanChartProps {
  overs: OverData[]
  className?: string
  height?: number
  showComparison?: boolean
  comparisonOvers?: OverData[]
}

export function ManhattanChart({
  overs,
  className,
  height = 200,
  showComparison = false,
  comparisonOvers = [],
}: ManhattanChartProps) {
  const maxRuns = Math.max(...overs.map((o) => o.runs), ...comparisonOvers.map((o) => o.runs), 1)
  const barWidth = Math.max(12, Math.min(32, 600 / Math.max(overs.length, 1)))

  return (
    <div className={cn("w-full", className)}>
      <div className="relative" style={{ height }}>
        {/* Y-axis grid lines */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <div
            key={fraction}
            className="absolute left-8 right-0 border-t border-border/30"
            style={{ bottom: `${fraction * 100}%` }}
          >
            <span className="absolute -left-8 -top-2 text-[10px] text-muted-foreground/60 tabular-nums w-6 text-right">
              {Math.round(maxRuns * fraction)}
            </span>
          </div>
        ))}

        {/* Bars */}
        <div className="absolute bottom-0 left-8 right-0 flex items-end gap-px h-full">
          {overs.map((over, i) => {
            const barHeight = (over.runs / maxRuns) * 100
            const compOver = comparisonOvers[i]
            const compHeight = compOver ? (compOver.runs / maxRuns) * 100 : 0

            return (
              <div key={over.overNumber} className="flex flex-col items-center flex-1 max-w-8 relative group">
                {/* Comparison bar (if enabled) */}
                {showComparison && compOver && (
                  <motion.div
                    className="w-full rounded-t bg-info/20 absolute bottom-0"
                    initial={{ height: 0 }}
                    animate={{ height: `${compHeight}%` }}
                    transition={{ duration: 0.5, delay: i * 0.03 }}
                  />
                )}

                {/* Primary bar */}
                <motion.div
                  className={cn(
                    "w-full rounded-t relative z-10",
                    over.wickets > 0
                      ? "bg-gradient-to-t from-wicket-red to-wicket-red/70"
                      : over.runs >= 12
                      ? "bg-gradient-to-t from-primary to-primary/70"
                      : "bg-gradient-to-t from-primary/70 to-primary/40"
                  )}
                  initial={{ height: 0 }}
                  animate={{ height: `${barHeight}%` }}
                  transition={{ duration: 0.5, delay: i * 0.03 }}
                  style={{ maxWidth: barWidth }}
                />

                {/* Wicket marker */}
                {over.wickets > 0 && (
                  <motion.div
                    className="absolute z-20 -top-1"
                    style={{ bottom: `${barHeight}%` }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.3, delay: i * 0.03 + 0.4 }}
                  >
                    <span className="text-[9px] font-bold text-wicket-red">W</span>
                  </motion.div>
                )}

                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-30 pointer-events-none">
                  <div className="glass-panel rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                    <span className="font-semibold">Over {over.overNumber}</span>
                    <span className="text-muted-foreground ml-1">{over.runs} runs</span>
                    {over.wickets > 0 && <span className="text-wicket-red ml-1">{over.wickets}W</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex ml-8 mt-1">
        {overs.map((over) => (
          <div key={over.overNumber} className="flex-1 max-w-8 text-center">
            <span className="text-[9px] text-muted-foreground/60 tabular-nums">{over.overNumber}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs">
        <div className="flex items-center gap-1">
          <span className="h-2 w-6 rounded bg-primary/60" />
          <span className="text-muted-foreground">Runs</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-6 rounded bg-wicket-red/60" />
          <span className="text-muted-foreground">Wicket over</span>
        </div>
      </div>
    </div>
  )
}
