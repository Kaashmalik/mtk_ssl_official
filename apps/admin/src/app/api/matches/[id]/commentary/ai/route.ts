export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, matches, teams, matchInnings } from "@mtk/database";
import { alias } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

// OpenAI API integration (placeholder - actual implementation would use OpenAI SDK)
// B161: a REAL provider call when COMMENTARY_AI_API_KEY is configured
// (OpenAI-compatible chat completions; base URL + model overridable). Without
// a key the route answers with the deterministic TEMPLATE and DISCLOSES it
// via the returned `source` — never claiming AI provenance it does not have.
// Not exported: Next.js route validation allows only handlers + config exports
// here; helper stays file-local (Batch 166 post-sync typecheck fix).
const commentaryAiConfigured = () => Boolean(process.env.COMMENTARY_AI_API_KEY?.trim())

async function callAiProvider(prompt: string): Promise<string> {
  const apiKey = process.env.COMMENTARY_AI_API_KEY!.trim()
  const baseUrl = (process.env.COMMENTARY_AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "")
  const model = process.env.COMMENTARY_AI_MODEL?.trim() || "gpt-4o-mini"
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        { role: "system", content: "You are a live cricket commentary writer. Answer with ONLY the commentary sentence(s), no preface, in the requested language and tone. Never invent facts not present in the match data." },
        { role: "user", content: prompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`commentary provider http ${response.status}`)
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = body.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("commentary provider returned no content")
  return text.slice(0, 800)
}

async function generateAiCommentary(
  matchData: any,
  language: string,
  tone: string
): Promise<{ text: string; source: "ai" | "template" }> {
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

  const fallbackText = templates[language] || templates.en;

  if (!commentaryAiConfigured()) {
    return { text: fallbackText, source: "template" };
  }
  try {
    const languageName = new Intl.DisplayNames(["en"], { type: "language" }).of(language) ?? language;
    const prompt = [
      `Write one or two sentences of ${toneDescriptions[tone] ?? "neutral cricket commentary"} in ${languageName}.`,
      `Current score: ${runs} runs, ${wickets} wickets from ${overs}.${balls} overs.`,
      wickets > 0 ? `Wickets lost: ${wickets}.` : "No wickets lost yet.",
      "Use only these facts; do not invent players or events.",
    ].join(" ");
    return { text: await callAiProvider(prompt), source: "ai" };
  } catch {
    // A provider failure degrades HONESTLY to the template, still labelled.
    return { text: fallbackText, source: "template" };
  }
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

    const generated = await generateAiCommentary(matchWithInnings, language, tone);

    return NextResponse.json({
      text: generated.text,
      // Provenance disclosure: the admin UI must ALWAYS render this so a
      // template line is never mistaken for model output.
      source: generated.source,
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

