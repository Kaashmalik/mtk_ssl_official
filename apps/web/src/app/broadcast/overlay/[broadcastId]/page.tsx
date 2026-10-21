import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BroadcastOverlay } from "@/components/broadcast/broadcast-overlay"
import { broadcastOverlaySecret, verifyBroadcastOverlayToken } from "@/lib/broadcast-overlay-token"
import { readBroadcastOverlaySnapshot } from "@/lib/broadcast-overlay-reads"

/**
 * ENH-09-01: 1920x1080 OBS browser source.
 *
 * The URL carries a short-lived read-only overlay token. Without a configured
 * secret or a valid token this route is indistinguishable from a missing
 * match. The page renders transparent so OBS can composite original graphics
 * over camera/video; it never wraps or masks a provider player.
 */

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Broadcast overlay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function BroadcastOverlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ broadcastId: string }>
  searchParams: Promise<{ token?: string; animations?: string }>
}) {
  const { broadcastId } = await params
  const { token, animations } = await searchParams
  let payload
  try {
    payload = verifyBroadcastOverlayToken(token ?? "", broadcastOverlaySecret())
  } catch {
    notFound()
  }
  if (!payload || payload.matchId !== broadcastId) notFound()

  const snapshot = await readBroadcastOverlaySnapshot({
    tenantId: payload.tenantId,
    matchId: payload.matchId,
  })
  if (!snapshot) notFound()

  const mode = animations === "off"
    ? "off"
    : animations === "reduced"
      ? "reduced"
      : "full"

  return (
    <>
      <style>{`
        html, body { background: transparent !important; margin: 0; overflow: hidden; }
        .overlay-stage { width: 1920px; height: 1080px; transform-origin: top left; }
        @media (prefers-reduced-motion: reduce) {
          .overlay-stage * { animation: none !important; transition: none !important; }
        }
      `}</style>
      <main className="overlay-stage relative bg-transparent text-white">
        <BroadcastOverlay
          initial={snapshot}
          matchId={payload.matchId}
          tenantId={payload.tenantId}
          token={token ?? ""}
          animations={mode}
        />
      </main>
    </>
  )
}
