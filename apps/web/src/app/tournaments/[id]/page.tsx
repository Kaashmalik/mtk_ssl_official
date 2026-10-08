import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { db, tournaments, teams, matches, matchInnings, leagueRegistrations } from "@mtk/database"
import { eq, asc, and, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { Calendar } from "lucide-react"
import { KnockoutBracket } from "@/components/tournaments/knockout-bracket"
import { requirePublicTenantId } from "@/lib/public-tenant"

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", registration: "Registration Open", live: "Live", completed: "Completed", cancelled: "Cancelled",
}

export default async function PublicTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params

  // Tenant-scoped: this route is unauthenticated, so every read below is pinned
  // to the tenant that owns the request host.
  const tenantId = await requirePublicTenantId()

  const [tournament] = await db.select().from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)))
    .limit(1)
  if (!tournament) notFound()

  const approvedRegs = await db.select().from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, id),
      eq(leagueRegistrations.status, "approved"),
      eq(leagueRegistrations.tenantId, tenantId),
    ))

  const registeredTeamIds = new Set<string>(approvedRegs.map(r => r.teamId))

  const legacyTeams = await db.select().from(teams)
    .where(and(eq(teams.tournamentId, id), eq(teams.tenantId, tenantId)))
    .orderBy(asc(teams.name))
  for (const t of legacyTeams) registeredTeamIds.add(t.id)

  const registeredTeams = (
    await Promise.all([...registeredTeamIds].map(async (teamId) => {
      const [team] = await db.select().from(teams)
        .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
        .limit(1)
      return team
    }))
  ).filter((t): t is NonNullable<typeof t> => !!t).sort((a, b) => a.name.localeCompare(b.name))

  const tournamentMatchesRaw = await db.select().from(matches)
    .where(and(eq(matches.tournamentId, id), eq(matches.tenantId, tenantId)))
    .orderBy(asc(matches.scheduledDate))

  const tournamentMatches = await Promise.all(tournamentMatchesRaw.map(async (m) => {
    const [teamA] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, m.teamAId), eq(teams.tenantId, tenantId))).limit(1)
    const [teamB] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, m.teamBId), eq(teams.tenantId, tenantId))).limit(1)
    const innings = await db.select().from(matchInnings)
      .where(and(eq(matchInnings.matchId, m.id), eq(matchInnings.tenantId, tenantId)))
    const teamAInn = innings.find(inn => inn.teamId === m.teamAId)
    const teamBInn = innings.find(inn => inn.teamId === m.teamBId)
    return {
      ...m,
      teamAName: teamA?.name ?? "TBD",
      teamBName: teamB?.name ?? "TBD",
      teamAScore: teamAInn ? `${teamAInn.totalRuns}/${teamAInn.totalWickets}` : "",
      teamBScore: teamBInn ? `${teamBInn.totalRuns}/${teamBInn.totalWickets}` : "",
      dateText: m.scheduledDate
        ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "TBD",
    }
  }))

  const completedMatches = tournamentMatchesRaw.filter(m => m.status === "completed")
  const standingsMap = new Map<string, { name: string; played: number; won: number; lost: number; points: number }>()
  for (const t of registeredTeams) standingsMap.set(t.id, { name: t.name, played: 0, won: 0, lost: 0, points: 0 })
  for (const m of completedMatches) {
    const a = standingsMap.get(m.teamAId)
    const b = standingsMap.get(m.teamBId)
    if (!a || !b) continue
    a.played++; b.played++
    if (m.winnerId === m.teamAId) { a.won++; a.points += 2; b.lost++ }
    else if (m.winnerId === m.teamBId) { b.won++; b.points += 2; a.lost++ }
    else { a.points += 1; b.points += 1 }
  }
  const standings = [...standingsMap.values()].sort((a, b) => b.points - a.points || b.won - a.won)

  // Knockout bracket: map match types to rounds. quarter_final -> 1, semi_final -> 2, final -> 3.
  const roundOf: Record<string, number> = {
    quarter_final: 1,
    semi_final: 2,
    final: 3,
  }
  const scoreByMatchTeam = new Map<string, number>()
  const tournamentMatchIds = tournamentMatchesRaw.map((m) => m.id)
  const inningsAll = tournamentMatchIds.length
    ? await db.select().from(matchInnings).where(inArray(matchInnings.matchId, tournamentMatchIds))
    : []
  for (const inn of inningsAll) {
    scoreByMatchTeam.set(`${inn.matchId}:${inn.teamId}`, inn.totalRuns)
  }

  const bracketMatches = tournamentMatchesRaw
    .filter((m) => roundOf[m.matchType] !== undefined)
    .map((m) => ({
      id: m.id,
      round: roundOf[m.matchType],
      label: m.matchType,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      teamA: {
        name: tournamentMatches.find((x) => x.id === m.id)?.teamAName ?? "TBD",
        score: scoreByMatchTeam.get(`${m.id}:${m.teamAId}`) ?? null,
      },
      teamB: {
        name: tournamentMatches.find((x) => x.id === m.id)?.teamBName ?? "TBD",
        score: scoreByMatchTeam.get(`${m.id}:${m.teamBId}`) ?? null,
      },
      winnerId: m.winnerId,
      status: m.status,
      matchNumber: m.matchNumber,
      isLive: m.status === "live",
    }))
    .sort((a, b) => a.round - b.round || (a.matchNumber ?? 0) - (b.matchNumber ?? 0))

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <p className="text-sm text-muted-foreground">{tournament.description}</p>
        </div>
        <Badge variant="outline">{STATUS_LABELS[tournament.status] ?? tournament.status}</Badge>
      </div>

      {bracketMatches.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Knockout Bracket</h2>
          <KnockoutBracket matches={bracketMatches} />
        </div>
      )}

{standings.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Points Table</CardTitle></CardHeader>
                  <CardContent className="px-0 sm:px-6">
                    {/* Narrow screens: let the table scroll rather than push the
                        page wide. The Team cell is width-constrained + truncated
                        so a long club name cannot squeeze out the P/W/L/Pts
                        columns — the numeric columns are what a reader scans. */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[22rem]">
                        <thead>
                          <tr className="border-b text-muted-foreground text-xs">
                            <th className="py-2 pl-6 text-left font-medium">Team</th>
                            <th className="py-2 px-2 text-center font-medium">P</th>
                            <th className="py-2 px-2 text-center font-medium">W</th>
                            <th className="py-2 px-2 text-center font-medium">L</th>
                            <th className="py-2 pr-6 text-center font-medium">Pts</th>
                          </tr>
                        </thead>
              <tbody>
                          {standings.map((s) => (
                            <tr key={s.name} className="border-b last:border-0">
                              <td className="py-2 pl-6 font-medium max-w-[10rem] truncate" title={s.name}>{s.name}</td>
                              <td className="py-2 px-2 text-center tabular-nums">{s.played}</td>
                              <td className="py-2 px-2 text-center tabular-nums">{s.won}</td>
                              <td className="py-2 px-2 text-center tabular-nums">{s.lost}</td>
                              <td className="py-2 pr-6 text-center font-semibold tabular-nums">{s.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Fixtures & Results</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {tournamentMatches.length === 0 && <p className="text-sm text-muted-foreground">No matches scheduled yet.</p>}
          {tournamentMatches.map((m) => (
            <Link key={m.id} href={`/matches/${m.id}`} className="block rounded-lg border p-3 hover:bg-muted/40">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{m.dateText}</span>
                <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.teamAName}</span>
                <span className="tabular-nums font-semibold">{m.teamAScore || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.teamBName}</span>
                <span className="tabular-nums font-semibold">{m.teamBScore || "-"}</span>
              </div>
              {m.result && <p className="text-xs text-muted-foreground mt-1">{m.result}</p>}
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
