export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, players, teams, profiles, users } from "@mtk/database";
import { eq } from "drizzle-orm";

// GET /api/players/[id] - Single player detail (platform console projection)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  try {
    const [player] = await db
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
        createdAt: players.createdAt,
        updatedAt: players.updatedAt,
        guardianConsentAt: players.guardianConsentAt,
        teams: { name: teams.name, logo_url: teams.logoUrl },
        profiles: {
          first_name: profiles.firstName,
          last_name: profiles.lastName,
          display_name: profiles.displayName,
          avatar_url: profiles.avatarUrl,
        },
        users: { email: users.email },
      })
      .from(players)
      .leftJoin(teams, eq(players.teamId, teams.id))
      .leftJoin(profiles, eq(players.profileId, profiles.id))
      .leftJoin(users, eq(players.userId, users.id))
      .where(eq(players.id, id))
      .limit(1);

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    return NextResponse.json({
      player: {
        id: player.id,
        tenant_id: player.tenantId,
        team_id: player.teamId,
        user_id: player.userId,
        profile_id: player.profileId,
        name: player.name,
        photo_url: player.photoUrl,
        date_of_birth: player.dateOfBirth,
        phone: player.phone,
        email: player.email,
        nationality: player.nationality,
        city: player.city,
        height_cm: player.heightCm,
        weight_kg: player.weightKg,
        jersey_number: player.jerseyNumber,
        role: player.role,
        batting_style: player.battingStyle,
        bowling_style: player.bowlingStyle,
        biography: player.biography,
        status: player.status,
        is_active: player.isActive,
        joined_at: player.joinedAt,
        created_at: player.createdAt.toISOString(),
        updated_at: player.updatedAt.toISOString(),
        guardian_consent_at: player.guardianConsentAt?.toISOString() ?? null,
        teams: player.teams,
        profiles: player.profiles,
        users: player.users,
      },
    });
  } catch (error) {
    console.error("Error fetching player:", error);
    return NextResponse.json({ error: "Failed to fetch player" }, { status: 500 });
  }
}
