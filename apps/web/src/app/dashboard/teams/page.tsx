import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, Shield } from "lucide-react"
import { requireRosterReadContext, readRosterTeams, rosterPageNumber } from "@/lib/roster-reads"
import { TeamListGrid } from "@/components/teams/team-list-grid"
import { unstable_noStore as noStore } from "next/cache"

// ─── Page ─────────────────────────────────────────────────────

export default async function TeamsPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const context = await requireRosterReadContext("team:read")
  const page = rosterPageNumber((await searchParams)?.page)
  const { data: teamsData, pagination } = await readRosterTeams(context.tenantId, { page, pageSize: 100 })
  const canCreate = context.role === "league_owner"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground mt-1">Manage teams, rosters, and squad composition.</p>
        </MotionWrapper>
        {canCreate && <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/teams/new">
            <Button variant="gradient-shine" size="lg"><Plus className="mr-2 h-4 w-4" />Add Team</Button>
          </Link>
        </MotionWrapper>}
      </div>

      {/* Stats */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{pagination.total}</p>
            <p className="text-xs text-muted-foreground">Total Teams</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{teamsData.filter((t) => t.isActive).length}</p>
            <p className="text-xs text-muted-foreground">Active on this page</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-info">{teamsData.reduce((sum, t) => sum + t.playerCount, 0)}</p>
            <p className="text-xs text-muted-foreground">Linked players on this page</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{new Set(teamsData.map((t) => t.city).filter(Boolean)).size}</p>
            <p className="text-xs text-muted-foreground">Cities on this page</p>
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
            <p className="text-lg font-semibold text-muted-foreground">{pagination.total ? "No teams on this page" : "No teams registered yet"}</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">No teams on this page. League owners can register teams.</p>
            {canCreate && <Link href="/dashboard/teams/new">
              <Button variant="gradient-shine" size="lg" className="mt-6"><Plus className="mr-2 h-4 w-4" />Add First Team</Button>
            </Link>}
          </div>
        </MotionWrapper>
      ) : (
        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <TeamListGrid initialTeams={teamsData.map(t => ({ id: t.id, name: t.name, shortName: t.shortName,
            primaryColor: t.primaryColor, logoUrl: t.logoUrl, city: t.city, isActive: t.isActive,
            playerCount: t.playerCount, wins: t.wins, losses: t.losses, played: t.played }))} />
        </MotionWrapper>
      )}
      <nav aria-label="Team pages" className="flex gap-4 items-center">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
        <p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, pagination.totalPages)}. Search and filters apply to this page, including archived teams.</p>
        {page < pagination.totalPages && <Link href={`?page=${page + 1}`}>Next</Link>}
      </nav>
    </div>
  )
}
