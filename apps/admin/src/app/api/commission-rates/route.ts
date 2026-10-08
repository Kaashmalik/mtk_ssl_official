export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, commissionRates } from "@mtk/database";
import { eq } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await db
      .select()
      .from(commissionRates)
      .orderBy(commissionRates.plan);

    return NextResponse.json({ commissionRates: data || [] });
  } catch (error) {
    console.error("Commission rates API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch commission rates" },
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
    const { plan, rate, description } = await request.json();

    if (!plan || rate === undefined) {
      return NextResponse.json(
        { error: "plan and rate are required" },
        { status: 400 }
      );
    }

    const [data] = await db
      .update(commissionRates)
      .set({
        rate: rate.toString(),
        description,
        updatedBy: adminId,
        updatedAt: new Date(),
      })
      .where(eq(commissionRates.plan, plan))
      .returning();

    if (!data) {
      return NextResponse.json(
        { error: "Commission rate not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ commissionRate: data });
  } catch (error) {
    console.error("Update commission rate error:", error);
    return NextResponse.json(
      { error: "Failed to update commission rate" },
      { status: 500 }
    );
  }
}

