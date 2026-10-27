export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, players, teams, profiles, users } from "@mtk/database";
import { eq, and, desc } from "drizzle-orm";

// GET /api/players - List all players
export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const teamId = searchParams.get("teamId");

  try {
    const conditions: any[] = [];
    if (tenantId) {
      conditions.push(eq(players.tenantId, tenantId));
    }
    if (teamId) {
      conditions.push(eq(players.teamId, teamId));
    }

    const data = await db
      .select({
        id: players.id,
        tenantId: players.tenantId,
        teamId: players.teamId,
        userId: players.userId,
        profileId: players.profileId,
        name: players.name,
        photoUrl: players.photoUrl,
        dateOfBirth: players.dateOfBirth,
        phone: players.phone,
        email: players.email,
        nationality: players.nationality,
        city: players.city,
        heightCm: players.heightCm,
        weightKg: players.weightKg,
        jerseyNumber: players.jerseyNumber,
        role: players.role,
        battingStyle: players.battingStyle,
        bowlingStyle: players.bowlingStyle,
        biography: players.biography,
        status: players.status,
        isActive: players.isActive,
        joinedAt: players.joinedAt,
        createdBy: players.createdBy,
        createdAt: players.createdAt,
        updatedAt: players.updatedAt,
        teams: {
          name: teams.name,
          logo_url: teams.logoUrl,
        },
        profiles: {
          first_name: profiles.firstName,
          last_name: profiles.lastName,
          display_name: profiles.displayName,
          avatar_url: profiles.avatarUrl,
        },
        users: {
          email: users.email,
        }
      })
      .from(players)
      .leftJoin(teams, eq(players.teamId, teams.id))
      .leftJoin(profiles, eq(players.profileId, profiles.id))
      .leftJoin(users, eq(players.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(players.createdAt));

    const mappedPlayers = data.map((p) => ({
      id: p.id,
      tenant_id: p.tenantId,
      team_id: p.teamId,
      user_id: p.userId,
      profile_id: p.profileId,
      name: p.name,
      photo_url: p.photoUrl,
      date_of_birth: p.dateOfBirth,
      phone: p.phone,
      email: p.email,
      nationality: p.nationality,
      city: p.city,
      height_cm: p.heightCm,
      weight_kg: p.weightKg,
      jersey_number: p.jerseyNumber,
      role: p.role,
      batting_style: p.battingStyle,
      bowling_style: p.bowlingStyle,
      biography: p.biography,
      status: p.status,
      is_active: p.isActive,
      joined_at: p.joinedAt,
      created_by: p.createdBy,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
      teams: p.teams,
      profiles: p.profiles,
      users: p.users,
    }));

    return NextResponse.json({ players: mappedPlayers });
  } catch (error) {
    console.error("Error fetching players:", error);
    return NextResponse.json(
      { error: "Failed to fetch players" },
      { status: 500 }
    );
  }
}

// POST /api/players - Create new player
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      tenant_id,
      team_id,
      user_id,
      profile_id,
      jersey_number,
      role,
      batting_style,
      bowling_style,
    } = body;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!tenant_id || !role || !name) {
      return NextResponse.json(
        { error: "League, player name and role are required" },
        { status: 400 }
      );
    }
    if (!z.string().uuid().safeParse(tenant_id).success) {
      return NextResponse.json({ error: "Invalid league" }, { status: 400 });
    }
    if (team_id && !z.string().uuid().safeParse(team_id).success) {
      return NextResponse.json({ error: "Invalid team" }, { status: 400 });
    }

    // A player must never be filed under a team from another league: the
    // console is a super-admin surface, so RLS cannot catch this for us.
    if (team_id) {
      const [team] = await db
        .select({ tenantId: teams.tenantId })
        .from(teams)
        .where(eq(teams.id, team_id))
        .limit(1);
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 400 });
      }
      if (team.tenantId !== tenant_id) {
        return NextResponse.json(
          { error: "Team does not belong to the selected league" },
          { status: 400 }
        );
      }
    }

    const parsedJersey =
      jersey_number === undefined || jersey_number === null || jersey_number === ""
        ? null
        : Number(jersey_number);
    if (
      parsedJersey !== null &&
      (!Number.isInteger(parsedJersey) || parsedJersey < 0 || parsedJersey > 999)
    ) {
      return NextResponse.json({ error: "Invalid jersey number" }, { status: 400 });
    }

    const [player] = await db
      .insert(players)
      .values({
        tenantId: tenant_id,
        teamId: team_id || null,
        userId: user_id || null,
        profileId: profile_id || null,
        jerseyNumber: parsedJersey,
        role: role,
        battingStyle: batting_style || null,
        bowlingStyle: bowling_style || null,
        isActive: true,
        name,
      })
      .returning();

    const mappedPlayer = {
      id: player.id,
      tenant_id: player.tenantId,
      team_id: player.teamId,
      user_id: player.userId,
      profile_id: player.profileId,
      name: player.name,
      jersey_number: player.jerseyNumber,
      role: player.role,
      batting_style: player.battingStyle,
      bowling_style: player.bowlingStyle,
      is_active: player.isActive,
    };

    return NextResponse.json({ player: mappedPlayer }, { status: 201 });
  } catch (error) {
    console.error("Error creating player:", error);
    return NextResponse.json(
      { error: "Failed to create player" },
      { status: 500 }
    );
  }
}

