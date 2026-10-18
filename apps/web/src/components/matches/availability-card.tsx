"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { useTranslations } from "next-intl"
import { setMatchAvailability } from "@/app/actions/match-availability"
import {
  AVAILABILITY_STATUSES,
  availabilityLabel,
  type AvailabilityStatus,
} from "@mtk/database/lib/match-availability-policy"

export interface AvailabilityAnswer {
  userId: string
  displayName: string | null
  status: string
}

const statusTone: Record<AvailabilityStatus, string> = {
  available: "bg-emerald-600 text-white",
  unavailable: "bg-red-600 text-white",
  maybe: "bg-amber-500 text-white",
}

/**
 * REG-05 (Batch 138): the member's self-service availability card. The
 * viewer can only ever change THEIR OWN answer (the server action carries
 * no actor parameter); the recorded answers list is league-internal
 * planning context, rendered as the plain recorded facts.
 */
export function AvailabilityCard({
  matchId,
  currentUserId,
  initialStatus,
  answers,
}: {
  matchId: string
  currentUserId: string | null
  initialStatus: AvailabilityStatus | null
  answers: AvailabilityAnswer[]
}) {
  const [status, setStatus] = useState<AvailabilityStatus | null>(initialStatus)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const t = useTranslations("availability")

  const record = (next: AvailabilityStatus) => {
    startTransition(async () => {
      try {
        const result = await setMatchAvailability({ matchId, status: next })
        setStatus(result.status)
        setMessage(result.changed ? t("recordedMessage", { label: t(next) }) : t("unchangedMessage"))
      } catch (err) {
        setMessage(err instanceof Error ? err.message : t(next))
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY_STATUSES.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={status === s ? "default" : "outline"}
              disabled={pending}
              title={t(`${s}Description`)}
              onClick={() => record(s)}
            >
              {t(s)}
            </Button>
          ))}
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        {answers.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("answersTitle")}</p>
            <ul className="space-y-1">
              {answers.map((a) => (
                <li key={a.userId} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-[11px] font-bold ${statusTone[(a.status as AvailabilityStatus) ?? "maybe"] ?? statusTone.maybe}`}>
                    {availabilityLabel(a.status).charAt(0)}
                  </span>
                  <span>{a.displayName || "Unnamed member"}</span>
                  <span className="text-xs text-muted-foreground">{availabilityLabel(a.status)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("answersNote")}
            </p>
          </div>
        )}
        {!currentUserId && (
          <p className="text-xs text-muted-foreground">{t("signInHint")}</p>
        )}
      </CardContent>
    </Card>
  )
}
