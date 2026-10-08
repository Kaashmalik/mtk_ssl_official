export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, matches, teams, tenants } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const streams = await db
      .select({
        id: matches.id,
        tenantId: matches.tenantId,
        streamSource: matches.streamSource,
        streamStatus: matches.streamStatus,
        liveStreamUrl: matches.liveStreamUrl,
        status: matches.status,
        scheduledDate: matches.scheduledDate,
        tenantName: tenants.name,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
      })
      .from(matches)
      .leftJoin(tenants, eq(matches.tenantId, tenants.id))
      .orderBy(desc(matches.updatedAt))
      .limit(200);

    const teamIds = Array.from(new Set(streams.flatMap((s) => [s.teamAId, s.teamBId])));
    const teamRows = teamIds.length
      ? await db.select({ id: teams.id, name: teams.name }).from(teams)
      : [];
    const nameById = new Map(teamRows.map((t) => [t.id, t.name]));

    return NextResponse.json({
      streams: streams.map((s) => ({
        ...s,
        teamAName: nameById.get(s.teamAId) ?? "TBD",
        teamBName: nameById.get(s.teamBId) ?? "TBD",
      })),
    });
  } catch (error) {
    console.error("[admin-live-streams] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch streams" }, { status: 500 });
  }
}