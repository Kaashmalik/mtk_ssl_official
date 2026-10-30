import { ImageResponse } from "next/og"

/**
 * Batch 119: the platform brand card for the home route's og:image via
 * Next's file convention. Static constants only — nothing is read, nothing
 * is fabricated. (Per-tenant brand images stay an explicit open scope: the
 * white-label metadata layer names the tenant, this image stays the
 * platform's own card until an owner requests per-tenant assets.)
 *
 * The mark mirrors public/icons/logo.svg / <BrandMark> as plain divs rather
 * than an <img>: Satori renders this route without filesystem access, and the
 * geometry is too small to justify shipping a second raster asset. Keep the
 * tile, bail, stump and ball proportions in step if the SVG changes.
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
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: 26,
              display: "flex",
              position: "relative",
              background: "linear-gradient(135deg, #22c55e 0%, #047857 100%)",
            }}
          >
            {/* bails */}
            <div style={{ position: "absolute", left: 24, top: 25, width: 23, height: 6, borderRadius: 3, backgroundColor: "#ffffff", display: "flex" }} />
            <div style={{ position: "absolute", left: 49, top: 25, width: 23, height: 6, borderRadius: 3, backgroundColor: "#ffffff", display: "flex" }} />
            {/* stumps */}
            <div style={{ position: "absolute", left: 25, top: 35, width: 10, height: 54, borderRadius: 5, backgroundColor: "#ffffff", display: "flex" }} />
            <div style={{ position: "absolute", left: 43, top: 35, width: 10, height: 54, borderRadius: 5, backgroundColor: "#ffffff", display: "flex" }} />
            <div style={{ position: "absolute", left: 61, top: 35, width: 10, height: 54, borderRadius: 5, backgroundColor: "#ffffff", display: "flex" }} />
            {/* ball with its seam ring */}
            <div style={{ position: "absolute", left: 61, top: 55, width: 44, height: 44, borderRadius: 22, backgroundColor: "#047857", display: "flex" }} />
            <div style={{ position: "absolute", left: 66, top: 60, width: 34, height: 34, borderRadius: 17, backgroundColor: "#dc2626", display: "flex" }} />
          </div>
          <div style={{ fontSize: 76, fontWeight: 700 }}>Shakir Super League</div>
        </div>
        <div style={{ marginTop: 30, fontSize: 40, color: "#cbd5e1" }}>
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
