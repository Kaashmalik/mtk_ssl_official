export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tenants } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await db
      .select()
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    return NextResponse.json({ leagues: data || [] });
  } catch (error) {
    console.error("Leagues API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leagues" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { leagueId, isActive } = await request.json();

    if (!leagueId || typeof isActive !== "boolean") {
      return NextResponse.json(
        { error: "leagueId and isActive are required" },
        { status: 400 }
      );
    }

    const [data] = await db
      .update(tenants)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(tenants.id, leagueId))
      .returning();

    if (!data) {
      return NextResponse.json(
        { error: "League not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ league: data });
  } catch (error) {
    console.error("Update league error:", error);
    return NextResponse.json(
      { error: "Failed to update league" },
      { status: 500 }
    );
  }
}


