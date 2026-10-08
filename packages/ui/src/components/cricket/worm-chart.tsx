"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts"

interface WormChartProps {
  data: Array<{
    over: number;
    team1Runs: number;
    team2Runs?: number;
  }>;
  team1Name: string;
  team2Name?: string;
}

export function WormChart({ data, team1Name, team2Name }: WormChartProps) {
  return (
    <div className="h-[300px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.2)" />
          <XAxis 
            dataKey="over" 
            tickLine={false} 
            axisLine={false} 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} 
          />
          <YAxis 
            tickLine={false} 
            axisLine={false} 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} 
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'hsl(var(--card))', 
              borderColor: 'hsl(var(--border))',
              borderRadius: '0.5rem',
              color: 'hsl(var(--foreground))'
            }} 
          />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          <Line 
            type="monotone" 
            dataKey="team1Runs" 
            name={team1Name} 
            stroke="oklch(0.6 0.16 145)" // Primary Green
            strokeWidth={3} 
            dot={false}
            activeDot={{ r: 6 }} 
          />
          {team2Name && (
             <Line 
               type="monotone" 
               dataKey="team2Runs" 
               name={team2Name} 
               stroke="oklch(0.6 0.15 240)" // Blue
               strokeWidth={3} 
               dot={false}
             />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
