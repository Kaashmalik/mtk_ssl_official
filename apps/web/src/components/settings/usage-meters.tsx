import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { db, teams, players } from "@mtk/database"
import { eq, count } from "drizzle-orm"
import { PLAN_LIMITS, type PlanKey } from "@mtk/database"

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const unlimited = max === Infinity
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100))
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{used}{unlimited ? "" : ` / ${max}`}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${unlimited ? 0 : Math.max(2, pct)}%` }} />
      </div>
      {unlimited && <p className="text-xs text-muted-foreground">Unlimited</p>}
    </div>
  )
}

export async function UsageMeters({ tenantId, plan }: { tenantId: string; plan: string }) {
  const [teamRows, playerRows] = await Promise.all([
    db.select({ value: count() }).from(teams).where(eq(teams.tenantId, tenantId)),
    db.select({ value: count() }).from(players).where(eq(players.tenantId, tenantId)),
  ])
  const limits = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.free
  const teamCount = Number(teamRows[0]?.value ?? 0)
  const playerCount = Number(playerRows[0]?.value ?? 0)

  return (
    <Card>
      <CardHeader><CardTitle>Plan Usage</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Meter label="Teams" used={teamCount} max={limits.maxTeams} />
        <Meter label="Players" used={playerCount} max={limits.maxPlayers} />
      </CardContent>
    </Card>
  )
}
