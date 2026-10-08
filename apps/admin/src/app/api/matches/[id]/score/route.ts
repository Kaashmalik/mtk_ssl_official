export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, matchInnings, matchBalls } from "@mtk/database";
import { eq } from "drizzle-orm";

// POST /api/matches/[id]/score - Update match score
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
      innings_id: inningsId,
      runs,
      is_wicket,
      is_wide,
      is_no_ball,
      is_bye,
      is_leg_bye,
      batsman_id,
      bowler_id,
      wicket_type,
    } = body;

    if (!inningsId || runs === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: innings_id, runs" },
        { status: 400 }
      );
    }

    // Get current innings data
    const [innings] = await db
      .select()
      .from(matchInnings)
      .where(eq(matchInnings.id, inningsId))
      .limit(1);

    if (!innings) {
      return NextResponse.json(
        { error: "Innings not found" },
        { status: 404 }
      );
    }

    // Calculate new totals
    const newRuns = innings.totalRuns + runs;
    const newWickets = is_wicket ? innings.totalWickets + 1 : innings.totalWickets;
    const newBalls = is_wide || is_no_ball ? innings.totalBalls : innings.totalBalls + 1;

    // Update innings
    await db
      .update(matchInnings)
      .set({
        totalRuns: newRuns,
        totalWickets: newWickets,
        totalBalls: newBalls,
        status: newWickets >= 10 || newBalls >= 120 ? "completed" : "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(matchInnings.id, inningsId));

    // Record the ball
    const currentOver = Math.floor(newBalls / 6) + 1;
    const currentBall = (newBalls % 6) || 6;

    const [ball] = await db
      .insert(matchBalls)
      .values({
        tenantId: innings.tenantId,
        matchId: matchId,
        inningsId,
        overNumber: currentOver,
        ballNumber: currentBall,
        batsmanId: batsman_id || null,
        bowlerId: bowler_id || null,
        runs: runs,
        isWicket: is_wicket || false,
        wicketType: wicket_type || null,
        isWide: is_wide || false,
        isNoBall: is_no_ball || false,
        isBye: is_bye || false,
        isLegBye: is_leg_bye || false,
      })
      .returning();

    // Map to camelCase to snake_case format for return
    const mappedBall = {
      id: ball.id,
      tenant_id: ball.tenantId,
      match_id: ball.matchId,
      innings_id: ball.inningsId,
      over_number: ball.overNumber,
      ball_number: ball.ballNumber,
      batsman_id: ball.batsmanId,
      bowler_id: ball.bowlerId,
      runs: ball.runs,
      is_wicket: ball.isWicket,
      wicket_type: ball.wicketType,
      is_wide: ball.isWide,
      is_no_ball: ball.isNoBall,
      is_bye: ball.isBye,
      is_leg_bye: ball.isLegBye,
    };

    return NextResponse.json({
      success: true,
      ball: mappedBall,
      innings: {
        total_runs: newRuns,
        total_wickets: newWickets,
        total_balls: newBalls,
      },
    });
  } catch (error) {
    console.error("Error updating score:", error);
    return NextResponse.json(
      { error: "Failed to update score" },
      { status: 500 }
    );
  }
}

