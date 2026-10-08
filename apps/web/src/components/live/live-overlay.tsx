"use client"

import { useEffect } from "react"
import { useScoringSocket } from "@/hooks/use-scoring-socket"
import { useScoringStore } from "@/stores/scoring-store"
import { LiveScorecard } from "@/components/scoring/live-scorecard"
import { CommentaryFeed } from "@/components/scoring/commentary-feed"
import { LanguageSelector } from "@/components/scoring/language-selector"
import { FanReactions } from "@/components/live/fan-reactions"

export function LiveOverlay({ matchId }: { matchId: string }) {
  const setMatchId = useScoringStore((s) => s.setMatchId)
  const matchStateId = useScoringStore((s) => s.matchId)

  useEffect(() => {
    if (matchStateId !== matchId) setMatchId(matchId)
  }, [matchId, matchStateId, setMatchId])

  useScoringSocket(matchId)

  return (
    <div className="space-y-3">
      <LiveScorecard compact />
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Commentary</h3>
          <LanguageSelector />
        </div>
        <CommentaryFeed />
      </div>
      <FanReactions matchId={matchId} />
    </div>
  )
}
