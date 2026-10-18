"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { useTranslations } from "next-intl"
import { raiseScorecardCorrection, resolveScorecardCorrectionRequest } from "@/app/actions/scorecard-corrections"
import { CORRECTION_REASONS, type CorrectionReason, type CorrectionStatus } from "@mtk/database/lib/scorecard-correction-policy"

export interface CorrectionEntry {
  id: string
  requestedBy: string
  displayName: string | null
  reason: string
  status: string
}

const statusTone: Record<string, string> = {
  open: "bg-amber-500 text-white",
  approved: "bg-emerald-600 text-white",
  dismissed: "bg-muted text-muted-foreground",
}

/**
 * REG-05 (Batch 141): the correction-request card. RECORDS, never
 * mutations - raising does not change the scorecard; the owner resolves
 * (approve/dismiss) and separately corrects through audited paths. The
 * member sees their own request state; the owner additionally sees every
 * request for the match.
 */
export function CorrectionRequestCard({
  matchId,
  viewerIsOwner,
  myUserId,
  myOpenRequest,
  requests,
}: {
  matchId: string
  viewerIsOwner: boolean
  myUserId: string | null
  myOpenRequest: CorrectionEntry | null
  requests: CorrectionEntry[]
}) {
  const t = useTranslations("corrections")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState<CorrectionReason>("wrong_runs")

  const raise = () => {
    startTransition(async () => {
      try {
        const result = await raiseScorecardCorrection({ matchId, reason })
        setMessage(result.changed ? t("raisedMessage") : t("openStatus"))
      } catch (err) {
        setMessage(err instanceof Error ? err.message : t("raiseButton"))
      }
    })
  }

  const resolve = (requestId: string, decision: "approved" | "dismissed") => {
    startTransition(async () => {
      try {
        await resolveScorecardCorrectionRequest({ requestId, decision })
        setMessage(t(decision === "approved" ? "approved" : "dismissed"))
      } catch (err) {
        setMessage(err instanceof Error ? err.message : t("title"))
      }
    })
  }

  const statusChip = (status: string) => (
    <span className={`inline-flex h-5 items-center justify-center rounded px-1.5 text-[11px] font-bold ${statusTone[status] ?? statusTone.dismissed}`}>
      {status === "approved" ? t("approved") : status === "dismissed" ? t("dismissed") : t("openStatus")}
    </span>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {myOpenRequest ? (
          <p className="text-sm">
            <span className="font-medium">{t("myRequestLabel")}: </span>
            {t(`reasons.${myOpenRequest.reason}`)}{" "}
            {statusChip(myOpenRequest.status)}
          </p>
        ) : (
          myUserId && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t("title")}
                value={reason}
                onChange={(e) => setReason(e.target.value as CorrectionReason)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {CORRECTION_REASONS.map((r) => (
                  <option key={r} value={r}>{t(`reasons.${r}`)}</option>
                ))}
              </select>
              <Button type="button" size="sm" disabled={pending} onClick={raise}>
                {t("raiseButton")}
              </Button>
            </div>
          )
        )}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        {viewerIsOwner && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("requestsTitle")}</p>
            {requests.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noneOpen")}</p>
            ) : (
              <ul className="space-y-1.5">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{r.displayName || "Unnamed member"}</span>
                    <span className="text-xs text-muted-foreground">{t(`reasons.${r.reason as CorrectionReason}`)}</span>
                    {statusChip(r.status as CorrectionStatus)}
                    {r.status === "open" && (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => resolve(r.id, "approved")}>
                          {t("approveButton")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => resolve(r.id, "dismissed")}>
                          {t("dismissButton")}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
