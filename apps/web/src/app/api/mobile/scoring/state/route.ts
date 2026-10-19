import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { getMatchForScoring, getMatchPlayersForScoring } from "@/app/actions/scoring"

export const dynamic = "force-dynamic"

/**
 * SCORE-08: authenticated mobile scoring-state hydration. Same authorisation
 * and shape as the dashboard scoring page's server actions — the native app
 * receives the current innings rows (with ids), the named squads, the writer
 * fencing values (handoverEpoch/scoringRevision) and its server-resolved
 * queue scope. Without this, a mobile scorer literally has no innings or
 * player identifiers to submit, which is why the old screen queued
 * unsyncable deliveries. Introspection only: no mutation surface exists here.
 */
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Sign in to score this match" }, { status: 401 })
  }
  const matchId = new URL(request.url).searchParams.get("matchId") ?? ""
  if (!/^[0-9a-f-]{36}$/i.test(matchId)) {
    return NextResponse.json({ error: "A valid matchId is required" }, { status: 400 })
  }
  try {
    const [state, players] = await Promise.all([
      getMatchForScoring(matchId),
      getMatchPlayersForScoring(matchId),
    ])
    return NextResponse.json({ state, players })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match state is unavailable"
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
