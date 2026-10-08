export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, featureFlags } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await db
      .select()
      .from(featureFlags)
      .orderBy(desc(featureFlags.createdAt));

    return NextResponse.json({ featureFlags: data || [] });
  } catch (error) {
    console.error("Feature flags API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feature flags" },
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
    const { flagId, isEnabled, rolloutPercentage, metadata } = await request.json();

    if (!flagId) {
      return NextResponse.json(
        { error: "flagId is required" },
        { status: 400 }
      );
    }

    const updateData: any = { updatedAt: new Date() };
    
    if (typeof isEnabled === "boolean") updateData.isEnabled = isEnabled;
    if (rolloutPercentage !== undefined) updateData.rolloutPercentage = rolloutPercentage.toString();
    if (metadata !== undefined) updateData.metadata = metadata;

    const [data] = await db
      .update(featureFlags)
      .set(updateData)
      .where(eq(featureFlags.id, flagId))
      .returning();

    if (!data) {
      return NextResponse.json(
        { error: "Feature flag not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ featureFlag: data });
  } catch (error) {
    console.error("Update feature flag error:", error);
    return NextResponse.json(
      { error: "Failed to update feature flag" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { key, name, description, isEnabled, rolloutPercentage, targetTenants, metadata } = await request.json();

    if (!key || !name) {
      return NextResponse.json(
        { error: "key and name are required" },
        { status: 400 }
      );
    }

    const [data] = await db
      .insert(featureFlags)
      .values({
        key,
        name,
        description,
        isEnabled: isEnabled || false,
        rolloutPercentage: rolloutPercentage ? rolloutPercentage.toString() : "0",
        targetTenants: targetTenants || null,
        metadata: metadata || null,
        createdBy: adminId,
      })
      .returning();

    return NextResponse.json({ featureFlag: data });
  } catch (error) {
    console.error("Create feature flag error:", error);
    return NextResponse.json(
      { error: "Failed to create feature flag" },
      { status: 500 }
    );
  }
}


