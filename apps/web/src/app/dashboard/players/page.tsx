import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, Inbox } from "lucide-react"
import { requireRosterReadContext, readRosterPlayers, rosterPageNumber } from "@/lib/roster-reads"
import { PlayerListTable } from "@/components/players/player-list-table"
import { unstable_noStore as noStore } from "next/cache"

// ─── Page ─────────────────────────────────────────────────────

export default async function PlayersPage({ searchParams }: { searchParams?: Promise<{ page?: string }> } = {}) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const context = await requireRosterReadContext("player:read")
  const page = rosterPageNumber((await searchParams)?.page)
  const { data: playersData, pagination } = await readRosterPlayers(context.tenantId, { page, pageSize: 100 })
  const canCreate = context.role === "league_owner"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Players</h1>
          <p className="text-muted-foreground mt-1">Register players and manage profiles.</p>
        </MotionWrapper>
        {canCreate && <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/players/new">
            <Button variant="gradient-shine" size="lg">
              <Plus className="mr-2 h-4 w-4" />
              Add Player
            </Button>
          </Link>
        </MotionWrapper>}
      </div>

      {/* Stats Bar */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{pagination.total}</p>
            <p className="text-xs text-muted-foreground">Total Players</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{playersData.filter((p) => p.isActive && p.status === "active").length}</p>
            <p className="text-xs text-muted-foreground">Active on this page</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-warning">{playersData.filter((p) => p.status === "injured").length}</p>
            <p className="text-xs text-muted-foreground">Injured on this page</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{new Set(playersData.map((p) => p.teamName).filter(Boolean)).size}</p>
            <p className="text-xs text-muted-foreground">Teams on this page</p>
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
            <p className="text-lg font-semibold text-muted-foreground">{pagination.total ? "No players on this page" : "No players registered yet"}</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">No players on this page. League owners can register players.</p>
            {canCreate && <Link href="/dashboard/players/new">
              <Button variant="gradient-shine" size="lg" className="mt-6">
                <Plus className="mr-2 h-4 w-4" />Add First Player
              </Button>
            </Link>}
          </div>
        </MotionWrapper>
      ) : (
        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <PlayerListTable initialPlayers={playersData.map(p => ({ id: p.id, name: p.name, role: p.role,
            jerseyNumber: p.jerseyNumber, battingStyle: p.battingStyle, teamName: p.teamName,
            city: p.city, status: p.status, isActive: p.isActive, photoUrl: p.photoUrl }))} />
        </MotionWrapper>
      )}
      <nav aria-label="Player pages" className="flex gap-4 items-center">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
        <p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, pagination.totalPages)}. Search and filters apply to this page, including archived players.</p>
        {page < pagination.totalPages && <Link href={`?page=${page + 1}`}>Next</Link>}
      </nav>
    </div>
  )
}
