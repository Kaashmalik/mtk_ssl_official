import { ImageResponse } from "next/og"

/**
 * Batch 119: the platform brand card for the home route's og:image via
 * Next's file convention. Static constants only — nothing is read, nothing
 * is fabricated. (Per-tenant brand images stay an explicit open scope: the
 * white-label metadata layer names the tenant, this image stays the
 * platform's own card until an owner requests per-tenant assets.)
 */
export const alt = "Shakir Super League — cricket tournaments, live scoring and standings"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function HomeOgImage() {
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
          padding: 60,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 22, height: 56, backgroundColor: "#1e40af", display: "flex" }} />
          <div style={{ fontSize: 76, fontWeight: 700 }}>Shakir Super League</div>
          <div style={{ width: 22, height: 56, backgroundColor: "#0f766e", display: "flex" }} />
        </div>
        <div style={{ marginTop: 24, fontSize: 40, color: "#cbd5e1" }}>
          Cricket tournaments, live scoring and standings
        </div>
        <div style={{ marginTop: 16, fontSize: 30, color: "#64748b" }}>
          For leagues across Pakistan and the global diaspora
        </div>
      </div>
    ),
    { ...size },
  )
}
