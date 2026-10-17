"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getMatchForScoring, recordBall } from "@/app/actions/scoring"
import { getQueuedBalls, removeQueuedBall, type QueuedBall } from "@/lib/offline-ball-queue"
import { unwrapScoringFenceResult } from "@/lib/scoring-fence"
import { reviewedDelivery } from "@/lib/scoring-recovery"
import type { ScoringPageSnapshot } from "@/lib/scoring-hydration"
import { Button, Card } from "@mtk/ui"

type Acknowledgement = { ballId: string; clientOpId: string | null; scoringRevision: number }

/** No discard/overwrite button: review authorizes only an ordinary canonical retry. */
export function ScoringRecoveryPanel({ matchId, onConfirmed }: {
  matchId: string; onConfirmed: (result: Acknowledgement) => void
}) {
  const [review, setReview] = useState<{ first?: QueuedBall; snapshot: ScoringPageSnapshot }>()
  const [reason, setReason] = useState("")
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const requestGeneration = useRef(0)
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    setBusy(true)
    setError(undefined)
    setReview(undefined)
    setChecked(false)
    try {
      const [snapshot, queue] = await Promise.all([getMatchForScoring(matchId), getQueuedBalls(matchId)])
      if (generation !== requestGeneration.current) return
      setReview({ first: queue[0], snapshot })
    } catch {
      if (generation !== requestGeneration.current) return
      setError("Could not load the authorized score and saved deliveries. Nothing has been changed.")
    } finally { if (generation === requestGeneration.current) setBusy(false) }
  }, [matchId])
  useEffect(() => { void load(); return () => { requestGeneration.current++ } }, [load])

  const item = review?.first
  const innings = item && review?.snapshot.innings.find(value => value.id === item.inningsId)
  return <Card className="p-3 space-y-3" aria-label="Saved delivery review">
    <h3 className="font-semibold">Review saved delivery</h3>
    <p className="text-sm">Only the first queued delivery can be reviewed. No score or delivery position is overwritten.
      An already accepted operation is confirmed without scoring twice. Otherwise its position must still match;
      if not, it stays saved for an official correction workflow.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {review && !item && <p role="status">No queued delivery is available. Reload to retrieve the official score; local-only work has not been discarded.</p>}
    {item && review && <>
      <p className="text-sm">Saved: {String(item.payload.overNumber)}.{String(item.payload.ballNumber)}, {String(item.payload.runs)} runs.
        Official: {innings?.totalRuns ?? "unavailable"}/{innings?.totalWickets ?? "?"}.
        Next position: {innings ? `${Math.floor(innings.totalBalls / 6)}.${innings.totalBalls % 6 + 1}` : "unavailable"}.
        Revision: {review.snapshot.match.scoringRevision ?? 0}.</p>
      {!review.snapshot.canScore && <p role="alert">You are not currently authorized to score this match.</p>}
      <label className="block text-sm">Review reason (10-1000 characters)
        <textarea className="mt-1 block w-full rounded border bg-background p-2" value={reason} maxLength={1000}
          disabled={busy} onChange={event => setReason(event.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />
        I compared this saved delivery with the official score and authorize a retry with its original identity and position.
      </label>
      <Button disabled={busy || !checked || reason.trim().length < 10 || !review.snapshot.canScore} onClick={async () => {
        setBusy(true)
        setError(undefined)
        try {
          const result = unwrapScoringFenceResult(await recordBall(reviewedDelivery(item, review.snapshot, reason)))
          // Canonical acknowledgement first. If local cleanup fails, a retry
          // uses the same operation ID and dedupes instead of scoring twice.
          onConfirmed(result)
          await removeQueuedBall(item.clientOpId)
          window.location.reload()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Review was not confirmed. The delivery is still saved.")
          setChecked(false)
        } finally { setBusy(false) }
      }}>Confirm reviewed retry</Button>
    </>}
    <Button variant="outline" disabled={busy} onClick={() => { void load() }}>{busy ? "Loading..." : "Refresh review"}</Button>
  </Card>
}
