export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tenants, tenantBranding, tournaments, teams, users } from "@mtk/database";
import { desc, eq, sql, count } from "drizzle-orm";

// GET /api/tenants - List all tenants
export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tenantsList = await db
      .select()
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    const tenantsWithCounts = await Promise.all(
      tenantsList.map(async (tenant) => {
        const [branding] = await db
          .select()
          .from(tenantBranding)
          .where(eq(tenantBranding.tenantId, tenant.id))
          .limit(1);

        const tournamentsCountResult = await db
          .select({ count: count() })
          .from(tournaments)
          .where(eq(tournaments.tenantId, tenant.id));

        const teamsCountResult = await db
          .select({ count: count() })
          .from(teams)
          .where(eq(teams.tenantId, tenant.id));

        // For users, tenant.id is in users.tenantIds array
        const usersCountResult = await db
          .select({ count: count() })
          .from(users)
          .where(sql`${tenant.id} = ANY(${users.tenantIds})`);

        return {
          ...tenant,
          tenant_branding: branding || null,
          tournaments: [{ count: tournamentsCountResult[0]?.count ?? 0 }],
          teams: [{ count: teamsCountResult[0]?.count ?? 0 }],
          users: [{ count: usersCountResult[0]?.count ?? 0 }],
        };
      })
    );

    return NextResponse.json({ tenants: tenantsWithCounts });
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return NextResponse.json(
      { error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

// POST /api/tenants - Create new tenant
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, slug, owner_id, plan = "free", logo_url } = body;

    // Validate required fields
    if (!name || !slug || !owner_id) {
      return NextResponse.json(
        { error: "Missing required fields: name, slug, owner_id" },
        { status: 400 }
      );
    }

    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name,
        slug,
        ownerId: owner_id,
        plan,
        isActive: true,
      })
      .returning();

    // Create default branding
    await db.insert(tenantBranding).values({
      tenantId: tenant.id,
      logoUrl: logo_url || null,
      hideSslBranding: false,
    });

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.error("Error creating tenant:", error);
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 }
    );
  }
}

