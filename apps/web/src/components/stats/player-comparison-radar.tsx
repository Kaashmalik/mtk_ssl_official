"use client"

import { useMemo } from "react"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"

export interface ComparisonPlayer {
  id: string
  name: string
  runs: number
  battingAverage: number
  strikeRate: number
  wickets: number
  bowlingAverage: number
  economy: number
  catches: number
}

/** Every axis is normalised to 0-100 against the better of the two players. */
function buildRadar(a: ComparisonPlayer, b: ComparisonPlayer) {
  const scale = (label: string, av: number, bv: number) => {
    const max = Math.max(av, bv, 1)
    return { metric: label, a: Math.round((av / max) * 100), b: Math.round((bv / max) * 100) }
  }

  return [
    scale("Runs", a.runs, b.runs),
    scale("Batting Avg", a.battingAverage, b.battingAverage),
    scale("Strike Rate", a.strikeRate, b.strikeRate),
    scale("Wickets", a.wickets, b.wickets),
    scale("Bowl Avg", a.bowlingAverage, b.bowlingAverage),
    scale("Economy", a.economy, b.economy),
    scale("Catches", a.catches, b.catches),
  ].filter((r) => !(r.a === 0 && r.b === 0))
}

export function PlayerComparisonRadar({ a, b }: { a: ComparisonPlayer; b: ComparisonPlayer }) {
  const data = useMemo(() => buildRadar(a, b), [a, b])
  const rows = [
    { label: "Runs", a: a.runs, b: b.runs },
    { label: "Batting Avg", a: a.battingAverage.toFixed(2), b: b.battingAverage.toFixed(2) },
    { label: "Strike Rate", a: a.strikeRate.toFixed(1), b: b.strikeRate.toFixed(1) },
    { label: "Wickets", a: a.wickets, b: b.wickets },
    { label: "Bowling Avg", a: a.bowlingAverage.toFixed(2), b: b.bowlingAverage.toFixed(2) },
    { label: "Economy", a: a.economy.toFixed(2), b: b.economy.toFixed(2) },
    { label: "Catches", a: a.catches, b: b.catches },
  ]

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          Not enough recorded statistics to compare these players yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Player Comparison</CardTitle>
        <CardDescription>
          {a.name} vs {b.name} — each axis is scaled against the pair&apos;s best value.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} outerRadius="70%">
                <PolarGrid />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} />
                <Tooltip />
                <Legend />
                <Radar name={a.name} dataKey="a" stroke="#22c55e" fill="#22c55e" fillOpacity={0.35} />
                <Radar name={b.name} dataKey="b" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="py-2 text-left font-medium">Metric</th>
                <th className="py-2 text-right font-medium">{a.name}</th>
                <th className="py-2 text-right font-medium">{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="py-2">{r.label}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{r.a}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}