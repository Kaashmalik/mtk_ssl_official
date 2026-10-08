import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, Shield } from "lucide-react"
import { getMyTenant } from "@/app/actions/tenants"
import { TeamListGrid } from "@/components/teams/team-list-grid"
import { db, teams, players, matches } from "@mtk/database"
import { eq, and, count, or } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

// ─── Data Fetching ────────────────────────────────────────────

async function getTeamsData(tenantId: string) {
  try {
    const teamsRaw = await db.select().from(teams)
      .where(eq(teams.tenantId, tenantId))
      .orderBy(teams.name)

    return await Promise.all(
      teamsRaw.map(async (t) => {
        const [[{ playerCount }], [{ wins }], [{ losses }]] = await Promise.all([
          db.select({ playerCount: count() }).from(players)
            .where(and(eq(players.teamId, t.id), eq(players.tenantId, tenantId))),
          db.select({ wins: count() }).from(matches)
            .where(and(
              eq(matches.tenantId, tenantId),
              eq(matches.status, "completed"),
              eq(matches.winnerId, t.id),
            )),
          db.select({ losses: count() }).from(matches)
            .where(and(
              eq(matches.tenantId, tenantId),
              eq(matches.status, "completed"),
              or(eq(matches.teamAId, t.id), eq(matches.teamBId, t.id)),
              // Exclude wins from total matches → losses = total - wins, but simpler to just count
            )),
        ])

        const totalPlayed = Number(losses)
        const teamWins = Number(wins)

        return {
          ...t,
          playerCount: Number(playerCount),
          wins: teamWins,
          losses: Math.max(0, totalPlayed - teamWins),
          played: totalPlayed,
        }
      })
    )
  } catch (error) {
    console.error("Failed to fetch teams:", error)
    return []
  }
}

// ─── Page ─────────────────────────────────────────────────────

export default async function TeamsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const teamsData = await getTeamsData(tenant.id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground mt-1">Manage teams, rosters, and squad composition.</p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/teams/new">
            <Button variant="gradient-shine" size="lg"><Plus className="mr-2 h-4 w-4" />Add Team</Button>
          </Link>
        </MotionWrapper>
      </div>

      {/* Stats */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{teamsData.length}</p>
            <p className="text-xs text-muted-foreground">Total Teams</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{teamsData.filter((t) => t.isActive).length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-info">{teamsData.reduce((sum, t) => sum + t.playerCount, 0)}</p>
            <p className="text-xs text-muted-foreground">Total Players</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{new Set(teamsData.map((t) => t.city).filter(Boolean)).size}</p>
            <p className="text-xs text-muted-foreground">Cities</p>
          </div>
        </div>
      </MotionWrapper>

      {/* Teams Grid */}
      {teamsData.length === 0 ? (
        <MotionWrapper variant="fadeInUp">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted/50 p-5 mb-4">
              <Shield className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="text-lg font-semibold text-muted-foreground">No teams registered yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">Add your first team to start building squads and scheduling matches.</p>
            <Link href="/dashboard/teams/new">
              <Button variant="gradient-shine" size="lg" className="mt-6"><Plus className="mr-2 h-4 w-4" />Add First Team</Button>
            </Link>
          </div>
        </MotionWrapper>
      ) : (
        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <TeamListGrid initialTeams={teamsData} />
        </MotionWrapper>
      )}
    </div>
  )
}
