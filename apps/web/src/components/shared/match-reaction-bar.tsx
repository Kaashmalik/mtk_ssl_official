"use client"

import { useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { toggleMatchReaction } from "@/app/actions/fan-reactions"
import { toast } from "sonner"
import { FAN_REACTION_TYPES, FAN_REACTION_LABELS, type FanReactionType } from "@mtk/database/lib/fan-reaction-policy"

/** Emoji per reaction type; labels + set come from the shared pure policy. */
const REACTION_EMOJI: Record<FanReactionType, string> = {
  four: "4️⃣",
  six: "6️⃣",
  wicket: "🎯",
  clap: "👏",
  fire: "🔥",
}

export function MatchReactionBar({
  matchId,
  initialCounts,
  initialMine,
}: {
  matchId: string
  initialCounts: Record<FanReactionType, number>
  initialMine: FanReactionType[]
}) {
  const [counts, setCounts] = useState(initialCounts)
  const [mine, setMine] = useState<FanReactionType[]>(initialMine)
  const [isPending, startTransition] = useTransition()

  const handleToggle = (reaction: FanReactionType) => {
    startTransition(async () => {
      try {
        const result = await toggleMatchReaction({ matchId }, reaction)
        if (result.action === "refused") {
          // Blocked is a durable refusal: also drop the optimistic state so
          // the bar reflects that this fan's toggles no longer apply.
          if (result.reason === "blocked") setMine([])
          const reason = result.reason === "rate_limited"
            ? "Too fast - take a short break before reacting again"
            : result.reason === "blocked"
              ? "Your fan interactions are currently blocked in this league"
              : "Reactions are not available for this match"
          toast.error(reason)
          return
        }
        if (result.counts) setCounts(result.counts)
        setMine(prev => prev.includes(reaction) ? prev.filter(r => r !== reaction) : [...prev, reaction])
        toast.success(result.action === "added"
          ? `Reaction added: ${FAN_REACTION_LABELS[reaction]}`
          : `Reaction removed: ${FAN_REACTION_LABELS[reaction]}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign in to react"
        toast.error(message)
      }
    })
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Match reactions - engagement only, they never affect results"
    >
      {FAN_REACTION_TYPES.map(type => {
        const active = mine.includes(type)
        return (
          <Button
            key={type}
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={() => handleToggle(type)}
            disabled={isPending}
            aria-pressed={active}
            aria-label={`${FAN_REACTION_LABELS[type]} - ${counts[type]} reactions`}
            className="gap-1.5"
          >
            <span aria-hidden="true">{REACTION_EMOJI[type]}</span>
            <span>{FAN_REACTION_LABELS[type]}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-xs">{counts[type]}</span>
          </Button>
        )
      })}
    </div>
  )
}
