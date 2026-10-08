export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, matches, tenants, tournaments, teams, venues, matchInnings } from "@mtk/database";
import { alias } from "drizzle-orm/pg-core";
import { eq, and } from "drizzle-orm";

// GET /api/matches - List all matches
export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const tournamentId = searchParams.get("tournamentId");
  const status = searchParams.get("status");

  try {
    const teamA = alias(teams, "team_a");
    const teamB = alias(teams, "team_b");
    const winnerTeam = alias(teams, "winner_team");

    const conditions: any[] = [];
    if (tenantId) {
      conditions.push(eq(matches.tenantId, tenantId));
    }
    if (tournamentId) {
      conditions.push(eq(matches.tournamentId, tournamentId));
    }
    if (status) {
      conditions.push(eq(matches.status, status as "live" | "completed" | "cancelled" | "scheduled" | "toss" | "innings_break" | "abandoned" | "no_result"));
    }

    const matchesList = await db
      .select({
        id: matches.id,
        tenantId: matches.tenantId,
        tournamentId: matches.tournamentId,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        venueId: matches.venueId,
        matchNumber: matches.matchNumber,
        matchType: matches.matchType,
        scheduledDate: matches.scheduledDate,
        status: matches.status,
        winnerId: matches.winnerId,
        tossDecision: matches.tossDecision,
        tossWinnerId: matches.tossWinnerId,
        tenants: {
          name: tenants.name
        },
        tournaments: {
          name: tournaments.name
        },
        team_a: {
          name: teamA.name,
          logo_url: teamA.logoUrl
        },
        team_b: {
          name: teamB.name,
          logo_url: teamB.logoUrl
        },
        venue: {
          name: venues.name,
          city: venues.city
        },
        winner: {
          name: winnerTeam.name
        }
      })
      .from(matches)
      .leftJoin(tenants, eq(matches.tenantId, tenants.id))
      .leftJoin(tournaments, eq(matches.tournamentId, tournaments.id))
      .leftJoin(teamA, eq(matches.teamAId, teamA.id))
      .leftJoin(teamB, eq(matches.teamBId, teamB.id))
      .leftJoin(venues, eq(matches.venueId, venues.id))
      .leftJoin(winnerTeam, eq(matches.winnerId, winnerTeam.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(matches.scheduledDate);

    const matchesWithInnings = await Promise.all(
      matchesList.map(async (m) => {
        const innings = await db
          .select()
          .from(matchInnings)
          .where(eq(matchInnings.matchId, m.id));

        return {
          id: m.id,
          tenant_id: m.tenantId,
          tournament_id: m.tournamentId,
          team_a_id: m.teamAId,
          team_b_id: m.teamBId,
          venue_id: m.venueId,
          match_number: m.matchNumber,
          match_type: m.matchType,
          scheduled_date: m.scheduledDate ? m.scheduledDate.toISOString() : null,
          status: m.status,
          winner_id: m.winnerId,
          toss_decision: m.tossDecision,
          toss_winner_id: m.tossWinnerId,
          tenants: m.tenants,
          tournaments: m.tournaments,
          team_a: m.team_a,
          team_b: m.team_b,
          venue: m.venue,
          winner: m.winner,
          match_innings: innings.map(inn => ({
            id: inn.id,
            tenant_id: inn.tenantId,
            match_id: inn.matchId,
            team_id: inn.teamId,
            innings_number: inn.inningsNumber,
            total_runs: inn.totalRuns,
            total_wickets: inn.totalWickets,
            total_balls: inn.totalBalls,
            extras: inn.extras,
            byes: inn.byes,
            leg_byes: inn.legByes,
            wides: inn.wides,
            no_balls: inn.noBalls,
            status: inn.status,
            created_at: inn.createdAt.toISOString(),
            updated_at: inn.updatedAt.toISOString(),
          })),
        };
      })
    );

    return NextResponse.json({ matches: matchesWithInnings });
  } catch (error) {
    console.error("Error fetching matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches" },
      { status: 500 }
    );
  }
}

// POST /api/matches - Create new match
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      tenant_id,
      tournament_id,
      team_a_id,
      team_b_id,
      venue_id,
      match_number,
      match_type,
      scheduled_date,
    } = body;

    if (!tenant_id || !team_a_id || !team_b_id || !scheduled_date) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const [match] = await db
      .insert(matches)
      .values({
        tenantId: tenant_id,
        tournamentId: tournament_id,
        teamAId: team_a_id,
        teamBId: team_b_id,
        venueId: venue_id,
        matchNumber: match_number,
        matchType: match_type || "group",
        scheduledDate: new Date(scheduled_date),
        status: "scheduled",
      })
      .returning();

    const mappedMatch = {
      id: match.id,
      tenant_id: match.tenantId,
      tournament_id: match.tournamentId,
      team_a_id: match.teamAId,
      team_b_id: match.teamBId,
      venue_id: match.venueId,
      match_number: match.matchNumber,
      match_type: match.matchType,
      scheduled_date: match.scheduledDate ? match.scheduledDate.toISOString() : null,
      status: match.status,
    };

    return NextResponse.json({ match: mappedMatch }, { status: 201 });
  } catch (error) {
    console.error("Error creating match:", error);
    return NextResponse.json(
      { error: "Failed to create match" },
      { status: 500 }
    );
  }
}

