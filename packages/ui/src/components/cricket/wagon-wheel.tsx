"use client"

import { motion } from "framer-motion"
import { cn } from "../../lib/utils"

interface ShotData {
  angle: number // 0-360 degrees from straight ahead
  distance: number // 0-100 normalized
  runs: number
  batsmanName?: string
  overNumber?: number
  ballNumber?: number
}

interface WagonWheelProps {
  shots: ShotData[]
  className?: string
  size?: number
  showLabels?: boolean
}

const runColors: Record<number, string> = {
  0: "oklch(0.5 0.02 260)",
  1: "oklch(0.6 0.1 200)",
  2: "oklch(0.6 0.12 150)",
  3: "oklch(0.65 0.15 80)",
  4: "oklch(0.6 0.2 150)",
  6: "oklch(0.6 0.25 300)",
}

export function WagonWheel({ shots, className, size = 300, showLabels = true }: WagonWheelProps) {
  const center = size / 2
  const pitchRadius = size * 0.08
  const fieldRadius = size * 0.44

  const fieldRegions = [
    { label: "Cover", angle: -45 },
    { label: "Mid-off", angle: -20 },
    { label: "Straight", angle: 0 },
    { label: "Mid-on", angle: 20 },
    { label: "Mid-wicket", angle: 45 },
    { label: "Square Leg", angle: 90 },
    { label: "Fine Leg", angle: 135 },
    { label: "Behind", angle: 180 },
    { label: "Third Man", angle: -135 },
    { label: "Point", angle: -90 },
  ]

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="drop-shadow-md">
        {/* Field circle */}
        <circle cx={center} cy={center} r={fieldRadius} fill="oklch(0.6 0.12 140 / 0.1)" stroke="oklch(0.6 0.12 140 / 0.25)" strokeWidth="1.5" />
        
        {/* Inner circles */}
        <circle cx={center} cy={center} r={fieldRadius * 0.6} fill="none" stroke="oklch(0.6 0.12 140 / 0.12)" strokeWidth="0.5" strokeDasharray="4 4" />
        <circle cx={center} cy={center} r={fieldRadius * 0.3} fill="none" stroke="oklch(0.6 0.12 140 / 0.12)" strokeWidth="0.5" strokeDasharray="4 4" />

        {/* Pitch strip */}
        <rect
          x={center - pitchRadius * 0.3}
          y={center - pitchRadius * 2}
          width={pitchRadius * 0.6}
          height={pitchRadius * 4}
          rx={2}
          fill="oklch(0.7 0.1 80 / 0.25)"
          stroke="oklch(0.7 0.1 80 / 0.4)"
          strokeWidth="0.5"
        />

        {/* Field region labels */}
        {showLabels && fieldRegions.map((region) => {
          const rad = (region.angle - 90) * (Math.PI / 180)
          const x = center + Math.cos(rad) * (fieldRadius + 14)
          const y = center + Math.sin(rad) * (fieldRadius + 14)
          return (
            <text
              key={region.label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted-foreground/50"
              fontSize="7"
              fontWeight="500"
            >
              {region.label}
            </text>
          )
        })}

        {/* Shot lines */}
        {shots.map((shot, i) => {
          const rad = (shot.angle - 90) * (Math.PI / 180)
          const dist = (shot.distance / 100) * fieldRadius
          const x2 = center + Math.cos(rad) * dist
          const y2 = center + Math.sin(rad) * dist
          const color = runColors[shot.runs] || runColors[1]

          return (
            <motion.g key={i}>
              <motion.line
                x1={center}
                y1={center}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={shot.runs >= 4 ? 2.5 : 1.5}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.8 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
              />
              <motion.circle
                cx={x2}
                cy={y2}
                r={shot.runs >= 4 ? 4 : 3}
                fill={color}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.05 + 0.3 }}
              />
              {shot.runs >= 4 && (
                <text x={x2} y={y2 - 7} textAnchor="middle" fontSize="8" fontWeight="bold" className="fill-foreground">
                  {shot.runs}
                </text>
              )}
            </motion.g>
          )
        })}

        {/* Batsman position */}
        <circle cx={center} cy={center} r={4} fill="oklch(0.5 0.22 25)" stroke="white" strokeWidth="1.5" />
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3 text-xs">
        {[1, 2, 3, 4, 6].map((runs) => (
          <div key={runs} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: runColors[runs] }} />
            <span className="text-muted-foreground">{runs} run{runs > 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
