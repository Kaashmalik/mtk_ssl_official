"use client"

import { useEffect, useState } from "react"
import Confetti from "react-confetti"
import { getScoringSocket } from "@/lib/scoring-socket"

const REACTIONS = ["🔥", "👏", "😱", "🏏", "🎉", "💔"]

export function FanReactions({ matchId }: { matchId: string }) {
  const [burst, setBurst] = useState<{ key: number; active: boolean } | null>(null)

  useEffect(() => {
    const socket = getScoringSocket()
    const handler = (data: { emoji: string }) => {
      setBurst({ key: Date.now(), active: true })
      setTimeout(() => setBurst((b) => (b ? { ...b, active: false } : b)), 1800)
      void data
    }
    socket.on("fan-reaction", handler)
    return () => { socket.off("fan-reaction", handler) }
  }, [])

  const react = (emoji: string) => {
    getScoringSocket().emit("fan-reaction", { matchId, emoji })
    setBurst({ key: Date.now(), active: true })
    setTimeout(() => setBurst((b) => (b ? { ...b, active: false } : b)), 1800)
  }

  return (
    <div className="relative">
      {burst?.active && (
        <div className="absolute inset-x-0 -top-24 pointer-events-none" key={burst.key}>
          <Confetti width={400} height={200} recycle={false} numberOfPieces={80} />
        </div>
      )}
      <div className="flex gap-2 justify-center">
        {REACTIONS.map((e) => (
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
    </div>
  )
}
