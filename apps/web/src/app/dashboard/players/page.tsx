import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, Inbox } from "lucide-react"
import { getMyTenant } from "@/app/actions/tenants"
import { PlayerListTable } from "@/components/players/player-list-table"
import { db, teams, players } from "@mtk/database"
import { eq } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

// ─── Data Fetching ────────────────────────────────────────────

async function getTeamName(teamId: string | null): Promise<string | null> {
  if (!teamId) return null
  try {
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1)
    return team?.name ?? null
  } catch {
    return null
  }
}

async function getPlayersData(tenantId: string) {
  try {
    const playersRaw = await db.select().from(players)
      .where(eq(players.tenantId, tenantId))
      .orderBy(players.name)

    return await Promise.all(
      playersRaw.map(async (p) => {
        const teamName = await getTeamName(p.teamId)
        return { ...p, teamName }
      })
    )
  } catch (error) {
    console.error("Failed to fetch players:", error)
    return []
  }
}

// ─── Page ─────────────────────────────────────────────────────

export default async function PlayersPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const playersData = await getPlayersData(tenant.id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Players</h1>
          <p className="text-muted-foreground mt-1">Register players and manage profiles.</p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/players/new">
            <Button variant="gradient-shine" size="lg">
              <Plus className="mr-2 h-4 w-4" />
              Add Player
            </Button>
          </Link>
        </MotionWrapper>
      </div>

      {/* Stats Bar */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{playersData.length}</p>
            <p className="text-xs text-muted-foreground">Total Players</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{playersData.filter((p) => p.status === "active").length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-warning">{playersData.filter((p) => p.status === "injured").length}</p>
            <p className="text-xs text-muted-foreground">Injured</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{new Set(playersData.map((p) => p.teamName).filter(Boolean)).size}</p>
            <p className="text-xs text-muted-foreground">Teams</p>
          </div>
        </div>
      </MotionWrapper>

      {/* Data Table or Empty State */}
      {playersData.length === 0 ? (
        <MotionWrapper variant="fadeInUp">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted/50 p-5 mb-4">
              <Inbox className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="text-lg font-semibold text-muted-foreground">No players registered yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">Add your first player to start building team rosters.</p>
            <Link href="/dashboard/players/new">
              <Button variant="gradient-shine" size="lg" className="mt-6">
                <Plus className="mr-2 h-4 w-4" />Add First Player
              </Button>
            </Link>
          </div>
        </MotionWrapper>
      ) : (
        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <PlayerListTable initialPlayers={playersData} />
        </MotionWrapper>
      )}
    </div>
  )
}
