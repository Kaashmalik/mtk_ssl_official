import React from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { db, teams, matches, matchInnings, leagueRegistrations } from "@mtk/database"
import { eq, asc, and, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { Calendar, Trophy } from "lucide-react"
import { KnockoutBracket } from "@/components/tournaments/knockout-bracket"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedTournament, readPublishedTournamentAwards, readPublishedTournamentPrizes, readPublishedTournamentChampion, readPublishedTournamentMilestones, readPublicBattingLeaderboard, readPublicBowlingLeaderboard } from "@/lib/public-visibility"
import { resolvePublicTournamentMetadata } from "@/lib/public-tournament-metadata"
import { buildTournamentSportsEvent } from "@/lib/sports-event-structured-data"
import { buildTournamentLeaders } from "@/lib/tournament-leaders"
import { TournamentLeaders } from "@/components/tournaments/tournament-leaders"
import { JsonLd } from "@/components/json-ld"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Bounded, fail-closed metadata: the same publication predicates as the
  // render below decide whether this page is indexable at all.
  return resolvePublicTournamentMetadata(id)
}
import { readFanTournamentPolls, readMyPollVoteSafe } from "@/lib/tournament-polls"
import { readAwardDisputeAffordanceSafe } from "@/lib/award-dispute-records"
import { AwardDisputeAffordance, AwardDisputePendingNotice } from "@/components/tournaments/award-dispute-affordance"
import { TournamentPollCard } from "@/components/shared/tournament-poll-card"
import { TournamentShareCard } from "@/components/shared/tournament-share-card"
import { MilestoneCards } from "@/components/tournaments/milestone-cards"
import { computeStandings, computeGroupStandings, type StandingsMatchInput } from "@/lib/standings"
import { computeFormGuide, type FormGuideMatchInput } from "@/lib/form-guide"
import { GroupStandings } from "@/components/tournaments/group-standings"
import { FormGuide } from "@/components/tournaments/form-guide"

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", registration: "Registration Open", live: "Live", completed: "Completed", cancelled: "Cancelled",
}

export default async function PublicTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params

  // Tenant-scoped AND publication-gated: this route is unauthenticated, so the
  // tournament must belong to the tenant that owns the request host and be
  // published. A draft or cancelled tournament 404s.
  const tenantId = await requirePublicTenantId()
  const tournament = await readPublishedTournament(tenantId, id)
  if (!tournament) notFound()
  // FAN-03: the PERSISTED champion (written once by the completion claim) -
  // not a re-derivation from current standings, which can change.
  const champion = await readPublishedTournamentChampion(tenantId, id)
  // FAN-01: open polls with the fan's own vote (fail-closed for guests -
  // they see read-only aggregate counts and a sign-in hint).
  const fanPolls = await readFanTournamentPolls(tenantId, id)
  const fanVotes = await Promise.all(fanPolls.map(poll => readMyPollVoteSafe(tenantId, poll.pollId)))
  // FAN-03: milestones derived from official scorecard rows (publication-gated).
  const milestones = await readPublishedTournamentMilestones(tenantId, id)
  // Batch 124: "Most Runs / Most Wickets" from the SAME publication-gated,
  // minor-consent-gated reads the leaderboards page uses, scoped to THIS
  // competition; the builder emits null when neither list has complete rows.
  const [battingLeaderRows, bowlingLeaderRows] = await Promise.all([
    readPublicBattingLeaderboard(tenantId, { tournamentId: id }),
    readPublicBowlingLeaderboard(tenantId, { tournamentId: id }),
  ])
  const tournamentLeaders = buildTournamentLeaders({ batting: battingLeaderRows, bowling: bowlingLeaderRows })

  // PUB-06: every raw query on this unauthenticated page selects EXPLICIT
  // columns - no full-row reads, so internal-only fields (createdBy,
  // contact/notes provenance, tenant plumbing) never load, let alone travel.
  const approvedRegs = await db.select({ teamId: leagueRegistrations.teamId }).from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, id),
      eq(leagueRegistrations.status, "approved"),
      eq(leagueRegistrations.tenantId, tenantId),
    ))

  const registeredTeamIds = new Set<string>(approvedRegs.map(r => r.teamId))

  const legacyTeams = await db.select({ id: teams.id, name: teams.name, shortName: teams.shortName }).from(teams)
    .where(and(eq(teams.tournamentId, id), eq(teams.tenantId, tenantId)))
    .orderBy(asc(teams.name))
  for (const t of legacyTeams) registeredTeamIds.add(t.id)

  const registeredTeams = (
    await Promise.all([...registeredTeamIds].map(async (teamId) => {
      const [team] = await db.select({ id: teams.id, name: teams.name, shortName: teams.shortName }).from(teams)
        .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
        .limit(1)
      return team
    }))
  ).filter((t): t is NonNullable<typeof t> => !!t).sort((a, b) => a.name.localeCompare(b.name))

  // Only the columns the fixtures list, standings inputs and bracket consume;
  // the full row stays server-side by construction.
  const matchColumns = {
    id: matches.id,
    status: matches.status,
    matchType: matches.matchType,
    matchNumber: matches.matchNumber,
    scheduledDate: matches.scheduledDate,
    teamAId: matches.teamAId,
    teamBId: matches.teamBId,
    winnerId: matches.winnerId,
    groupLabel: matches.groupLabel,
    result: matches.result,
  }
  const tournamentMatchesRaw = await db.select(matchColumns).from(matches)
    .where(and(eq(matches.tournamentId, id), eq(matches.tenantId, tenantId)))
    .orderBy(asc(matches.scheduledDate))

  const standingsInputs: StandingsMatchInput[] = []
  const tournamentMatches = await Promise.all(tournamentMatchesRaw.map(async (m) => {
    const [teamA] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, m.teamAId), eq(teams.tenantId, tenantId))).limit(1)
    const [teamB] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, m.teamBId), eq(teams.tenantId, tenantId))).limit(1)
    const innings = await db.select({
      teamId: matchInnings.teamId,
      totalRuns: matchInnings.totalRuns,
      totalBalls: matchInnings.totalBalls,
      totalWickets: matchInnings.totalWickets,
    }).from(matchInnings)
      .where(and(eq(matchInnings.matchId, m.id), eq(matchInnings.tenantId, tenantId)))
    const teamAInn = innings.find(inn => inn.teamId === m.teamAId)
    const teamBInn = innings.find(inn => inn.teamId === m.teamBId)
    standingsInputs.push({
      matchId: m.id, teamAId: m.teamAId, teamBId: m.teamBId,
      status: m.status, winnerId: m.winnerId, groupLabel: m.groupLabel,
      innings: [
        ...(teamAInn ? [{ teamId: m.teamAId, runs: teamAInn.totalRuns, balls: teamAInn.totalBalls }] : []),
        ...(teamBInn ? [{ teamId: m.teamBId, runs: teamBInn.totalRuns, balls: teamBInn.totalBalls }] : []),
      ],
    })
    return {
      id: m.id,
      status: m.status,
      matchType: m.matchType,
      matchNumber: m.matchNumber,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      result: m.result,
      teamAName: teamA?.name ?? "TBD",
      teamBName: teamB?.name ?? "TBD",
      teamAScore: teamAInn ? `${teamAInn.totalRuns}/${teamAInn.totalWickets}` : "",
      teamBScore: teamBInn ? `${teamBInn.totalRuns}/${teamBInn.totalWickets}` : "",
      dateText: m.scheduledDate
        ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "TBD",
    }
  }))

  // Shared rule-versioned standings (v1: 2/1/0, cricket NRR, points -> NRR ->
  // wins -> name). The public table shows the compact P/W/L/Pts columns.
  const standings = computeStandings({
    teams: registeredTeams.map((team) => ({ id: team.id, name: team.name, shortName: team.shortName })),
    matches: standingsInputs,
  })

  const groupStandings = computeGroupStandings({ teams: registeredTeams, matches: standingsInputs })

  // Batch 122: SportsEvent structured data from the ALREADY-gated read —
  // a hidden competition emits no script at all.
  const sportsEvent = buildTournamentSportsEvent(tournament)

  // FAN-03 (Batch 165): the approved form-guide analytic package - a pure,
  // rule-versioned fold over the SAME official published match rows the
  // standings consume. Only resulted/voided matches contribute letters; an
  // upcoming or in-progress match can never manufacture form.
  const formGuideInputs: FormGuideMatchInput[] = tournamentMatchesRaw.map((m) => ({
    id: m.id,
    status: m.status,
    scheduledDate: m.scheduledDate,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    winnerId: m.winnerId,
    resultText: m.result,
  }))
  const formGuideTeamNames = new Map(registeredTeams.map((t) => [t.id, t.name]))
  for (const m of tournamentMatches) {
    if (!formGuideTeamNames.has(m.teamAId) && m.teamAName !== "TBD") formGuideTeamNames.set(m.teamAId, m.teamAName)
    if (!formGuideTeamNames.has(m.teamBId) && m.teamBName !== "TBD") formGuideTeamNames.set(m.teamBId, m.teamBName)
  }
  const formGuideRows = computeFormGuide(formGuideInputs, formGuideTeamNames)

  // Official award gallery (PUB-04): only ACTIVE, organizer-declared awards of
  // this already-published tournament. Fan favorites do not exist in this data.
  const awards = await readPublishedTournamentAwards(tenantId, id)
  const prizes = await readPublishedTournamentPrizes(tenantId, id)
  // PUB-04 disputes: the raise affordance is offered only to registered
  // members; guests and non-members get null and the page is unchanged.
  const disputeAffordance = awards.length > 0
    ? await readAwardDisputeAffordanceSafe(tenantId, id)
    : null
  const awardWinnerName = (award: (typeof awards)[number]) =>
    award.playerName ?? award.teamName ?? "Winner record unavailable"

  // Knockout bracket: map match types to rounds. quarter_final -> 1, semi_final -> 2, final -> 3.
  const roundOf: Record<string, number> = {
    quarter_final: 1,
    semi_final: 2,
    final: 3,
  }
  const scoreByMatchTeam = new Map<string, number>()
  const tournamentMatchIds = tournamentMatchesRaw.map((m) => m.id)
  const inningsAll = tournamentMatchIds.length
    ? await db.select({ matchId: matchInnings.matchId, teamId: matchInnings.teamId, totalRuns: matchInnings.totalRuns })
        .from(matchInnings).where(inArray(matchInnings.matchId, tournamentMatchIds))
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
    <>
      {sportsEvent ? <JsonLd data={sportsEvent} /> : null}
      <div className="max-w-4xl mx-auto space-y-6 p-4">
        <div className="flex items-start justify-between">
          <div>
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <p className="text-sm text-muted-foreground">{tournament.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <TournamentShareCard
            tournamentId={id}
            tournamentName={tournament.name}
            championName={champion?.championTeamName ?? null}
          />
          <Badge variant="outline">{STATUS_LABELS[tournament.status] ?? tournament.status}</Badge>
        </div>
      </div>

      {/* FAN-03 hall of fame: persisted champion, shown exactly as recorded. */}
      {champion && (
        <Card className="border-yellow-500/40 bg-gradient-to-r from-yellow-500/10 to-transparent">
          <CardContent className="flex items-center gap-3 py-4">
            <Trophy className="h-6 w-6 text-yellow-500" aria-hidden="true" />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Champion</p>
              <p className="text-lg font-bold">{champion.championTeamName}</p>
            </div>
            <span className="sr-only">{champion.championTeamName} won {tournament.name}</span>
          </CardContent>
        </Card>
      )}

      {/* FAN-01 moderated polls: open polls only, aggregate counts never
          per-fan, votes are engagement only - disclosed on every card. */}
      {fanPolls.length > 0 && (
        <section className="space-y-2" aria-label="Fan polls">
          <h2 className="text-lg font-semibold">Fan polls</h2>
          {fanPolls.map((poll, index) => (
            <TournamentPollCard
              key={poll.pollId}
              poll={poll}
              myVote={fanVotes[index]?.vote ?? null}
              canVote={fanVotes[index]?.canVote ?? false}
            />
          ))}
        </section>
      )}

      {/* FAN-03: milestone cards - derived facts from official scorecards. */}
      <MilestoneCards milestones={milestones} />

      {bracketMatches.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Knockout Bracket</h2>
          <KnockoutBracket matches={bracketMatches} />
        </div>
      )}

      <GroupStandings groups={groupStandings} />

      {/* FAN-03 (Batch 165): approved analytic package - the derived form
          guide. Same official facts as the points table; disclosure attached. */}
      <FormGuide rows={formGuideRows} />

      {/* Batch 124: Most Runs / Most Wickets from the publication-gated
          leaderboard reads; only present when at least one list has rows. */}
      {tournamentLeaders ? <TournamentLeaders data={tournamentLeaders} /> : null}

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

      {awards.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Official Awards</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Declared by this league&apos;s organizers. These are official awards only —
              fan favorites, if ever introduced, will be shown separately and never mixed in.
            </p>
            {awards.map((award) => (
              <div key={award.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{award.categoryLabel}</span>
                  <Badge variant="outline" className="text-[10px]">Official</Badge>
                </div>
                <p className="text-sm mt-1">{awardWinnerName(award)}</p>
                {award.citation && <p className="text-xs text-muted-foreground mt-1">{award.citation}</p>}
                <p className="text-xs text-muted-foreground mt-1">Declared {award.declaredAt.toISOString().slice(0, 10)}</p>
                {/* PUB-04 disputes: rendered ONLY for registered members of the
                    league (readAwardDisputeAffordanceSafe returns null for
                    guests and non-members — anonymous output is unchanged). */}
                {disputeAffordance && (
                  disputeAffordance.myOpenDisputeAwardIds.includes(award.id)
                    ? <AwardDisputePendingNotice />
                    : <AwardDisputeAffordance tournamentId={id} awardId={award.id} />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {prizes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Prizes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Approved prize categories declared by this league&apos;s organizers.
              Categories and amounts are the league&apos;s own decisions.
            </p>
            {prizes.map((prize) => (
              <div key={prize.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{prize.categoryName}</span>
                  <Badge variant="outline" className="text-[10px]">Approved</Badge>
                </div>
                <p className="text-sm mt-1">
                  {prize.amount === null ? "Non-cash prize" : `${prize.currency} ${prize.amount}`}
                  {prize.placement ? <span className="text-muted-foreground"> · {prize.placement}</span> : null}
                </p>
                {prize.sponsor && (
                  <p className="text-xs text-muted-foreground mt-1">Sponsored by {prize.sponsor}</p>
                )}
              </div>
            ))}
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
    </>
  )
}
