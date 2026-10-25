import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { db, teams, players } from "@mtk/database"
import { eq, count } from "drizzle-orm"
import { PLAN_LIMITS, type PlanKey } from "@mtk/database"

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const unlimited = max === Infinity
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100))
  const tone = unlimited
    ? "bg-linear-to-r from-primary/70 via-primary to-primary/70 bg-[length:200%_100%] animate-shimmer opacity-60"
    : pct >= 90
      ? "bg-linear-to-r from-red-500 to-red-400"
      : pct >= 70
        ? "bg-linear-to-r from-amber-500 to-amber-400"
        : "bg-linear-to-r from-primary to-primary/80"
  return (
    <div className="motion-reveal group/meter space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{used}</span>
          {unlimited ? <span className="ml-1.5 text-xs">unlimited</span> : <span className="ml-1 text-xs">of {max}</span>}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border border-border/60 bg-muted/70" role="img" aria-label={`${label}: ${used} of ${unlimited ? "unlimited" : max}`}>
        <div
          className={`h-full rounded-full shadow-[0_0_8px_-2px] shadow-primary/40 transition-[width] duration-700 ease-out ${tone}`}
          style={{ width: `${unlimited ? 100 : Math.max(2, pct)}%` }}
        />
      </div>
      {!unlimited && <p className="text-xs text-muted-foreground">{pct}% of plan capacity{pct >= 90 ? " — consider upgrading" : ""}</p>}
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
