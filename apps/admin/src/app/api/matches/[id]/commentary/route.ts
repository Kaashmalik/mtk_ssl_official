export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, commentaryEvents, matches } from "@mtk/database";
import { eq, and, desc } from "drizzle-orm";

// GET /api/matches/[id]/commentary - Get match commentary
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: matchId } = await params;
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language");

    const conditions = [eq(commentaryEvents.matchId, matchId)];
    if (language) {
      conditions.push(eq(commentaryEvents.language, language));
    }

    const data = await db
      .select()
      .from(commentaryEvents)
      .where(and(...conditions))
      .orderBy(desc(commentaryEvents.createdAt))
      .limit(50);

    const mappedCommentary = data.map((c) => ({
      id: c.id,
      tenant_id: c.tenantId,
      match_id: c.matchId,
      over_number: c.overNumber,
      ball_number: c.ballNumber,
      language: c.language,
      tone: c.tone,
      text: c.text,
      is_ai_generated: c.isAiGenerated,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    }));

    return NextResponse.json({ commentary: mappedCommentary });
  } catch (error) {
    console.error("Error fetching commentary:", error);
    return NextResponse.json(
      { error: "Failed to fetch commentary" },
      { status: 500 }
    );
  }
}

// POST /api/matches/[id]/commentary - Add commentary
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: matchId } = await params;
    const body = await request.json();
    const {
      text,
      language,
      tone,
      is_ai_generated,
      over_number,
      ball_number,
    } = body;

    if (!text) {
      return NextResponse.json(
        { error: "Missing required field: text" },
        { status: 400 }
      );
    }

    // Get match details to find tenant_id
    const [match] = await db
      .select({ tenantId: matches.tenantId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    const [commentary] = await db
      .insert(commentaryEvents)
      .values({
        tenantId: match.tenantId,
        matchId: matchId,
        overNumber: over_number || 0,
        ballNumber: ball_number || 0,
        language: language || "en",
        tone: tone || "neutral",
        text,
        isAiGenerated: is_ai_generated || false,
      })
      .returning();

    const mappedCommentary = {
      id: commentary.id,
      tenant_id: commentary.tenantId,
      match_id: commentary.matchId,
      over_number: commentary.overNumber,
      ball_number: commentary.ballNumber,
      language: commentary.language,
      tone: commentary.tone,
      text: commentary.text,
      is_ai_generated: commentary.isAiGenerated,
    };

    return NextResponse.json({ commentary: mappedCommentary }, { status: 201 });
  } catch (error) {
    console.error("Error adding commentary:", error);
    return NextResponse.json(
      { error: "Failed to add commentary" },
      { status: 500 }
    );
  }
}

