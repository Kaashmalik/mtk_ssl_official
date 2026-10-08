export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tournaments, tenants, teams, matches } from "@mtk/database";
import { eq, and, desc, count } from "drizzle-orm";

// GET /api/tournaments - List all tournaments
export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const status = searchParams.get("status");

  try {
    const conditions: any[] = [];
    if (tenantId) {
      conditions.push(eq(tournaments.tenantId, tenantId));
    }
    if (status) {
      conditions.push(eq(tournaments.status, status as "draft" | "registration" | "live" | "completed" | "cancelled"));
    }

    const data = await db
      .select({
        id: tournaments.id,
        tenantId: tournaments.tenantId,
        name: tournaments.name,
        slug: tournaments.slug,
        description: tournaments.description,
        format: tournaments.format,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        registrationOpen: tournaments.registrationOpen,
        registrationDeadline: tournaments.registrationDeadline,
        maxTeams: tournaments.maxTeams,
        status: tournaments.status,
        createdBy: tournaments.createdBy,
        createdAt: tournaments.createdAt,
        updatedAt: tournaments.updatedAt,
        tenants: {
          name: tenants.name,
          slug: tenants.slug,
        }
      })
      .from(tournaments)
      .leftJoin(tenants, eq(tournaments.tenantId, tenants.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tournaments.createdAt));

    const tournamentsWithCounts = await Promise.all(
      data.map(async (t) => {
        const teamsCountResult = await db
          .select({ count: count() })
          .from(teams)
          .where(eq(teams.tournamentId, t.id));

        const matchesCountResult = await db
          .select({ count: count() })
          .from(matches)
          .where(eq(matches.tournamentId, t.id));

        return {
          id: t.id,
          tenant_id: t.tenantId,
          name: t.name,
          slug: t.slug,
          description: t.description,
          format: t.format,
          start_date: t.startDate,
          end_date: t.endDate,
          registration_open: t.registrationOpen,
          registration_deadline: t.registrationDeadline,
          max_teams: t.maxTeams,
          status: t.status,
          created_by: t.createdBy,
          created_at: t.createdAt.toISOString(),
          updated_at: t.updatedAt.toISOString(),
          tenants: t.tenants,
          teams: [{ count: teamsCountResult[0]?.count ?? 0 }],
          matches: [{ count: matchesCountResult[0]?.count ?? 0 }],
        };
      })
    );

    return NextResponse.json({ tournaments: tournamentsWithCounts });
  } catch (error) {
    console.error("Error fetching tournaments:", error);
    return NextResponse.json(
      { error: "Failed to fetch tournaments" },
      { status: 500 }
    );
  }
}

// POST /api/tournaments - Create new tournament
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      tenant_id,
      name,
      slug,
      description,
      format,
      start_date,
      end_date,
      max_teams,
      registration_deadline,
    } = body;

    if (!tenant_id || !name || !slug || !format) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const [tournament] = await db
      .insert(tournaments)
      .values({
        tenantId: tenant_id,
        name,
        slug,
        description: description || null,
        format: format as any,
        startDate: start_date || null,
        endDate: end_date || null,
        maxTeams: max_teams ? parseInt(max_teams) : null,
        registrationDeadline: registration_deadline || null,
        createdBy: adminId,
        status: "draft",
      })
      .returning();

    const mappedTournament = {
      id: tournament.id,
      tenant_id: tournament.tenantId,
      name: tournament.name,
      slug: tournament.slug,
      description: tournament.description,
      format: tournament.format,
      start_date: tournament.startDate,
      end_date: tournament.endDate,
      status: tournament.status,
    };

    return NextResponse.json({ tournament: mappedTournament }, { status: 201 });
  } catch (error) {
    console.error("Error creating tournament:", error);
    return NextResponse.json(
      { error: "Failed to create tournament" },
      { status: 500 }
    );
  }
}

