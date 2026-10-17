"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { toast } from "sonner"
import { removeModeratedReaction } from "@/app/actions/fan-reaction-moderation"
import { FAN_REACTION_LABELS, type FanReactionType } from "@mtk/database/lib/fan-reaction-policy"

export type ModeratableReactionRow = {
  id: string
  reaction: FanReactionType
  fanName: string | null
  createdAt: string
}

/**
 * Owner-only moderation card (FAN-01). The public surface shows aggregates
 * only; this is where the league owner sees individual reaction rows on their
 * match and may remove one. Removal is audited server-side; here a successful
 * remove simply drops the row, an already-gone row reports honestly.
 */
export function ReactionModerationCard({
  matchId,
  initialReactions,
}: {
  matchId: string
  initialReactions: ModeratableReactionRow[]
}) {
  const [rows, setRows] = useState(initialReactions)
  const [isPending, startTransition] = useTransition()

  const handleRemove = (reactionId: string) => {
    startTransition(async () => {
      try {
        const result = await removeModeratedReaction({ matchId, reactionId })
        if (!result.removed) {
          toast.error("This reaction is already gone - refreshing your view")
        }
        setRows(prev => prev.filter(row => row.id !== reactionId))
        if (result.removed) toast.success("Reaction removed")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Removal failed")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fan reaction moderation</CardTitle>
        <p className="text-xs text-muted-foreground">
          Reactions are engagement only - removing one never affects scores,
          standings or awards. The public page shows counts without names.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reactions to moderate on this match.</p>
        ) : (
          <ul className="space-y-2" aria-label="Individual reactions on this match">
            {rows.map(row => (
              <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{FAN_REACTION_LABELS[row.reaction]}</Badge>
                  <span className="text-muted-foreground">{row.fanName ?? "A league member"}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemove(row.id)}
                  disabled={isPending}
                  aria-label={`Remove the ${FAN_REACTION_LABELS[row.reaction]} reaction`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
