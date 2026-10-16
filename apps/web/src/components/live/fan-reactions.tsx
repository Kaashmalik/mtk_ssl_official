"use client"

import { useEffect, useState } from "react"
import Confetti from "react-confetti"
import { getScoringSocket } from "@/lib/scoring-socket"
import { PUBLIC_FAN_REACTIONS, isScopedFanReaction } from "@mtk/database/lib/public-scoring-events"

export function FanReactions({ matchId, tenantId }: { matchId: string; tenantId: string }) {
  const [burst, setBurst] = useState<{ key: number; active: boolean } | null>(null)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    const socket = getScoringSocket()
    let timer: ReturnType<typeof setTimeout> | undefined
    setBurst(null)
    setNotice("")
    const handler = (data: unknown) => {
      if (!isScopedFanReaction(data, tenantId, matchId)) return
      if (timer) clearTimeout(timer)
      setBurst({ key: Date.now(), active: true })
      timer = setTimeout(() => setBurst((b) => (b ? { ...b, active: false } : b)), 1800)
    }
    socket.on("fan-reaction", handler)
    return () => { socket.off("fan-reaction", handler); if (timer) clearTimeout(timer) }
  }, [matchId, tenantId])

  const react = (emoji: string) => {
    // Only the scoped, server-confirmed broadcast triggers the visual reaction.
    getScoringSocket().emit("fan-reaction", { matchId, tenantId, emoji }, (ack?: { success?: boolean; error?: string }) => {
      if (ack?.success === false) setNotice(ack.error || "Reaction unavailable")
      else if (ack?.success === true) setNotice("")
    })
  }

  return (
    <div className="relative">
      {burst?.active && (
        <div className="absolute inset-x-0 -top-24 pointer-events-none" key={burst.key}>
          <Confetti width={400} height={200} recycle={false} numberOfPieces={80} />
        </div>
      )}
      <div className="flex gap-2 justify-center">
        {PUBLIC_FAN_REACTIONS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`React ${e}`}
            onClick={() => react(e)}
            className="text-2xl hover:scale-125 transition-transform active:scale-150"
          >
            {e}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>
    </div>
  )
}
