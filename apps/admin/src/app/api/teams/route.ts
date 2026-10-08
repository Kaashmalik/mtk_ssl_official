export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, teams, tenants, tournaments, players, users } from "@mtk/database";
import { alias } from "drizzle-orm/pg-core";
import { eq, and, count } from "drizzle-orm";

// GET /api/teams - List all teams
export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const tournamentId = searchParams.get("tournamentId");

  try {
    const captainUser = alias(users, "captain_user");
    const managerUser = alias(users, "manager_user");

    const conditions: any[] = [];
    if (tenantId) {
      conditions.push(eq(teams.tenantId, tenantId));
    }
    if (tournamentId) {
      conditions.push(eq(teams.tournamentId, tournamentId));
    }

    const data = await db
      .select({
        id: teams.id,
        tenantId: teams.tenantId,
        tournamentId: teams.tournamentId,
        name: teams.name,
        shortName: teams.shortName,
        slug: teams.slug,
        description: teams.description,
        city: teams.city,
        logoUrl: teams.logoUrl,
        bannerUrl: teams.bannerUrl,
        primaryColor: teams.primaryColor,
        secondaryColor: teams.secondaryColor,
        captainId: teams.captainId,
        managerId: teams.managerId,
        jerseyColor: teams.jerseyColor,
        homeGround: teams.homeGround,
        foundedYear: teams.foundedYear,
        maxSquadSize: teams.maxSquadSize,
        isActive: teams.isActive,
        createdBy: teams.createdBy,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
        tenants: {
          name: tenants.name
        },
        tournaments: {
          name: tournaments.name
        },
        captain: {
          email: captainUser.email
        },
        manager: {
          email: managerUser.email
        }
      })
      .from(teams)
      .leftJoin(tenants, eq(teams.tenantId, tenants.id))
      .leftJoin(tournaments, eq(teams.tournamentId, tournaments.id))
      .leftJoin(captainUser, eq(teams.captainId, captainUser.id))
      .leftJoin(managerUser, eq(teams.managerId, managerUser.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(teams.name);

    const teamsWithCounts = await Promise.all(
      data.map(async (t) => {
        const playersCountResult = await db
          .select({ count: count() })
          .from(players)
          .where(eq(players.teamId, t.id));

        return {
          id: t.id,
          tenant_id: t.tenantId,
          tournament_id: t.tournamentId,
          name: t.name,
          short_name: t.shortName,
          slug: t.slug,
          description: t.description,
          city: t.city,
          logo_url: t.logoUrl,
          banner_url: t.bannerUrl,
          primary_color: t.primaryColor,
          secondary_color: t.secondaryColor,
          captain_id: t.captainId,
          manager_id: t.managerId,
          jersey_color: t.jerseyColor,
          home_ground: t.homeGround,
          founded_year: t.foundedYear,
          max_squad_size: t.maxSquadSize,
          is_active: t.isActive,
          created_by: t.createdBy,
          created_at: t.createdAt.toISOString(),
          updated_at: t.updatedAt.toISOString(),
          tenants: t.tenants,
          tournaments: t.tournaments,
          captain: t.captain,
          manager: t.manager,
          players: [{ count: playersCountResult[0]?.count ?? 0 }],
        };
      })
    );

    return NextResponse.json({ teams: teamsWithCounts });
  } catch (error) {
    console.error("Error fetching teams:", error);
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      { status: 500 }
    );
  }
}

// POST /api/teams - Create new team
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
      name,
      slug,
      logo_url,
      captain_id,
      manager_id,
      jersey_color,
      home_ground,
    } = body;

    if (!tenant_id || !name || !slug) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const [team] = await db
      .insert(teams)
      .values({
        tenantId: tenant_id,
        tournamentId: tournament_id || null,
        name,
        slug,
        logoUrl: logo_url || null,
        captainId: captain_id || null,
        managerId: manager_id || null,
        jerseyColor: jersey_color || null,
        homeGround: home_ground || null,
        isActive: true,
      })
      .returning();

    const mappedTeam = {
      id: team.id,
      tenant_id: team.tenantId,
      tournament_id: team.tournamentId,
      name: team.name,
      slug: team.slug,
      logo_url: team.logoUrl,
      captain_id: team.captainId,
      manager_id: team.managerId,
      jersey_color: team.jerseyColor,
      home_ground: team.homeGround,
      is_active: team.isActive,
    };

    return NextResponse.json({ team: mappedTeam }, { status: 201 });
  } catch (error) {
    console.error("Error creating team:", error);
    return NextResponse.json(
      { error: "Failed to create team" },
      { status: 500 }
    );
  }
}

