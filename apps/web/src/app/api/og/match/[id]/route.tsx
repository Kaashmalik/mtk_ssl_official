import { ImageResponse } from "next/og"
import { db, matches, teams, matchInnings } from "@mtk/database"
import { eq, and, asc } from "drizzle-orm"
import { getPublicTenantContext } from "@/lib/public-tenant"

export const dynamic = "force-dynamic"

/** Rendered when the match does not exist *or* is not in this request's tenant. */
function notFoundImage(reason: string) {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#111827',
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        <h1 style={{ fontSize: 60, fontWeight: 'bold', color: '#16a34a' }}>Shakir Super League</h1>
        <p style={{ fontSize: 30, color: '#9ca3af', marginTop: 20 }}>{reason}</p>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Tenant-scoped: OG images are unauthenticated and fetched by crawlers, so
    // an unscoped read would leak another tenant's teams and scores into a
    // shareable image. Fails closed to the placeholder image.
    const tenantCtx = await getPublicTenantContext()
    if (!tenantCtx) return notFoundImage("Match not found")

    const tenantId = tenantCtx.tenantId

    // Fetch match
    const [match] = await db.select().from(matches)
      .where(and(eq(matches.id, id), eq(matches.tenantId, tenantId)))
      .limit(1)

    if (!match) {
      return notFoundImage("Match not found")
    }

    // Fetch Team A details
    const [teamA] = await db.select().from(teams).where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1)
    // Fetch Team B details
    const [teamB] = await db.select().from(teams).where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, tenantId))).limit(1)

    // Fetch Innings details
    const inningsRaw = await db.select().from(matchInnings)
      .where(and(eq(matchInnings.matchId, id), eq(matchInnings.tenantId, tenantId)))
      .orderBy(asc(matchInnings.inningsNumber))

    const teamAName = teamA?.name ?? "Team A"
    const teamBName = teamB?.name ?? "Team B"
    const teamAShort = teamA?.shortName ?? "TBA"
    const teamBShort = teamB?.shortName ?? "TBB"
    const teamAColor = teamA?.primaryColor || "#3B82F6"
    const teamBColor = teamB?.primaryColor || "#EF4444"

    const inn1 = inningsRaw.find(inn => inn.teamId === match.teamAId)
    const inn2 = inningsRaw.find(inn => inn.teamId === match.teamBId)

    const teamAScore = inn1 ? `${inn1.totalRuns}/${inn1.totalWickets}` : "—"
    const teamBScore = inn2 ? `${inn2.totalRuns}/${inn2.totalWickets}` : "—"
    const teamAOvers = inn1 ? `${Math.floor(inn1.totalBalls / 6)}.${inn1.totalBalls % 6}` : "0.0"
    const teamBOvers = inn2 ? `${Math.floor(inn2.totalBalls / 6)}.${inn2.totalBalls % 6}` : "0.0"

    const resultText = match.result || (match.status === "live" ? "MATCH IS LIVE" : match.status.toUpperCase())
    const matchFormat = match.matchFormat ? match.matchFormat.toUpperCase() : "T20"

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            backgroundImage: `linear-gradient(135deg, #0f172a, #1e1b4b)`,
            padding: 80,
            color: '#fff',
            fontFamily: 'sans-serif',
            position: 'relative',
          }}
        >
          {/* Top Logo Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.1em', color: '#10b981' }}>
              SHAKIR SUPER LEAGUE
            </span>
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                padding: '6px 16px',
                borderRadius: 20,
                border: '1px solid rgba(255, 255, 255, 0.15)',
              }}
            >
              {matchFormat} MATCH
            </span>
          </div>

          {/* Scoreboard Middle Area */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', margin: '40px 0' }}>
            {/* Team A */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div
                style={{
                  height: 110,
                  width: 110,
                  borderRadius: 24,
                  backgroundColor: teamAColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 36,
                  fontWeight: 'bold',
                  border: '2px solid rgba(255, 255, 255, 0.2)',
                }}
              >
                {teamAShort}
              </div>
              <span style={{ fontSize: 22, fontWeight: 700, marginTop: 16, textAlign: 'center', width: '100%' }}>
                {teamAName}
              </span>
              <span style={{ fontSize: 44, fontWeight: 800, marginTop: 10, color: '#f8fafc' }}>
                {teamAScore}
              </span>
              <span style={{ fontSize: 18, color: '#94a3b8', marginTop: 4 }}>
                ({teamAOvers} overs)
              </span>
            </div>

            {/* VS Divider */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 40px' }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: 'rgba(255, 255, 255, 0.3)', letterSpacing: '0.2em' }}>VS</span>
            </div>

            {/* Team B */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div
                style={{
                  height: 110,
                  width: 110,
                  borderRadius: 24,
                  backgroundColor: teamBColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 36,
                  fontWeight: 'bold',
                  border: '2px solid rgba(255, 255, 255, 0.2)',
                }}
              >
                {teamBShort}
              </div>
              <span style={{ fontSize: 22, fontWeight: 700, marginTop: 16, textAlign: 'center', width: '100%' }}>
                {teamBName}
              </span>
              <span style={{ fontSize: 44, fontWeight: 800, marginTop: 10, color: '#f8fafc' }}>
                {teamBScore}
              </span>
              <span style={{ fontSize: 18, color: '#94a3b8', marginTop: 4 }}>
                ({teamBOvers} overs)
              </span>
            </div>
          </div>

          {/* Bottom Result Bar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '16px 32px',
              borderRadius: 16,
              width: '100%',
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.05em', color: '#34d399', textAlign: 'center' }}>
              {resultText.toUpperCase()}
            </span>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    )
  } catch (error: unknown) {
    console.error("Failed to generate OG image:", error)
    return new Response("Failed to generate image", { status: 500 })
  }
}
