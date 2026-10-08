"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { CreditCard } from "lucide-react"
import { issuePlayerId, revokePlayerId } from "@/app/actions/player-ids"

export function PlayerIdActions({
  playerId,
  card,
}: {
  playerId: string
  card: { id: string; formattedId: string; isValid: boolean } | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [issued, setIssued] = useState(card)

  const run = (fn: () => Promise<unknown>, ok: string) =>
    startTransition(async () => {
      try {
        await fn()
        toast.success(ok)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed")
      }
    })

  if (!issued) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            const res = await issuePlayerId(playerId)
            setIssued({
              id: res.playerId.id,
              formattedId: res.playerId.formattedId,
              isValid: res.playerId.isValid,
            })
          }, "Player ID issued")
        }
      >
        <CreditCard className="h-4 w-4 mr-2" />
        {isPending ? "Issuing..." : "Issue Player ID"}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="font-mono">{issued.formattedId}</Badge>
      <Button asChild variant="outline" size="sm">
        <a href={`/dashboard/players/id-card/${issued.id}`}>View Card</a>
      </Button>
      {issued.isValid && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              await revokePlayerId(playerId)
              setIssued((s) => (s ? { ...s, isValid: false } : s))
            }, "Player ID revoked")
          }
        >
          Revoke
        </Button>
      )}
    </div>
  )
}