import { ImageResponse } from "next/og"
import { notFound } from "next/navigation"
import { resolveMatchOgRenderData } from "@/lib/match-og-image"

/**
 * Batch 119: the match-centre OG share card (1200x630). Next's file
 * convention wires this image into the page's og:image automatically; the
 * data comes from `resolveMatchOgRenderData`, which is bound by the SAME
 * publication gates as the page render — a hidden match has no image, and
 * the only strings drawn are truthful ones (team names + result/format/
 * date). Colors are strict-hex validated in the lib before they reach the
 * canvas.
 */
export const alt = "Match centre share card"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function MatchOgImage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const data = await resolveMatchOgRenderData(matchId)
  // A hidden match has no card: the image endpoint 404s rather than
  // rendering a placeholder a scraper could archive.
  if (!data) notFound()

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#f8fafc",
          fontSize: 48,
          padding: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ width: 28, height: 64, backgroundColor: data.accentA, display: "flex" }} />
          <div style={{ fontSize: 72, fontWeight: 700 }}>{data.heading}</div>
          <div style={{ width: 28, height: 64, backgroundColor: data.accentB, display: "flex" }} />
        </div>
        <div style={{ marginTop: 28, fontSize: 40, color: "#cbd5e1" }}>{data.subLine}</div>
        {data.live ? (
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#ef4444", display: "flex" }} />
            <div style={{ fontSize: 32, fontWeight: 700, color: "#ef4444" }}>LIVE</div>
          </div>
        ) : null}
        <div style={{ marginTop: 16, fontSize: 28, color: "#64748b" }}>Shakir Super League — Match Centre</div>
      </div>
    ),
    { ...size },
  )
}
