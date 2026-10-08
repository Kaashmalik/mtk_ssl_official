export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, matches, teams, matchInnings } from "@mtk/database";
import { alias } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

// OpenAI API integration (placeholder - actual implementation would use OpenAI SDK)
async function generateAiCommentary(
  matchData: any,
  language: string,
  tone: string
): Promise<string> {
  const toneDescriptions: Record<string, string> = {
    neutral: "neutral cricket commentary",
    hype: "exciting and energetic commentary",
    premium: "professional broadcast-quality commentary",
    social: "short and punchy social media style",
  };

  const score = matchData.match_innings?.[0];
  const runs = score?.total_runs || 0;
  const wickets = score?.total_wickets || 0;
  const overs = Math.floor((score?.total_balls || 0) / 6);
  const balls = (score?.total_balls || 0) % 6;

  const templates: Record<string, string> = {
    en: `${matchData.team_a?.name} are at ${runs}/${wickets} after ${overs}.${balls} overs. ${toneDescriptions[tone]} continues as the match progresses.`,
    ur: `${matchData.team_a?.name} نے ${runs} رنز بنائے ہیں ${wickets} وکٹوں کے نقصان پر ${overs} اوورز میں۔`,
    pa: `${matchData.team_a?.name} ने ${runs} रंज बनाए हन ${wickets} विकेटां दे नुक्सान ते ${overs} ओवरां च।`,
    ps: `${matchData.team_a?.name} د ${runs} منډې کړي د ${wickets} ویکټونو په زیان سره د ${overs} اوورونو کې.`,
    sd: `${matchData.team_a?.name} ${runs} رنز ٺاهيا آهن ${wickets} وڪيٽن جي نقصان تي ${overs} اوورن ۾.`,
  };

  return templates[language] || templates.en;
}

// POST /api/matches/[id]/commentary/ai - Generate AI commentary
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
    const { language = "en", tone = "neutral" } = body;

    const teamA = alias(teams, "team_a");
    const teamB = alias(teams, "team_b");

    const [match] = await db
      .select({
        id: matches.id,
        tenantId: matches.tenantId,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        team_a: {
          name: teamA.name
        },
        team_b: {
          name: teamB.name
        }
      })
      .from(matches)
      .leftJoin(teamA, eq(matches.teamAId, teamA.id))
      .leftJoin(teamB, eq(matches.teamBId, teamB.id))
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    const innings = await db
      .select()
      .from(matchInnings)
      .where(eq(matchInnings.matchId, matchId));

    // Map innings to snake_case format for generateAiCommentary function
    const matchWithInnings = {
      ...match,
      match_innings: innings.map(inn => ({
        id: inn.id,
        tenant_id: inn.tenantId,
        match_id: inn.matchId,
        team_id: inn.teamId,
        innings_number: inn.inningsNumber,
        total_runs: inn.totalRuns,
        total_wickets: inn.totalWickets,
        total_balls: inn.totalBalls,
        extras: inn.extras,
        byes: inn.byes,
        leg_byes: inn.legByes,
        wides: inn.wides,
        no_balls: inn.noBalls,
        status: inn.status,
      })),
    };

    const generatedText = await generateAiCommentary(matchWithInnings, language, tone);

    return NextResponse.json({
      text: generatedText,
      language,
      tone,
      match_id: matchId,
    });
  } catch (error) {
    console.error("Error generating AI commentary:", error);
    return NextResponse.json(
      { error: "Failed to generate AI commentary" },
      { status: 500 }
    );
  }
}

