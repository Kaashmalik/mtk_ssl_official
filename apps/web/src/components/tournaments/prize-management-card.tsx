"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Loader2, Trophy } from "lucide-react"
import { approvePrize, recordPayout, savePrize } from "@/app/actions/prizes"
import type { PrizeManagementContext, PrizeManagementRow } from "@/lib/prize-records"

/**
 * Verbatim UI copy for the organizer prize-management control (PUB-05 UI
 * slice). Extracted as pure constants so tests assert exactly what the
 * organizer sees. Payout copy says "recorded" and never claims the platform
 * verified a payment.
 */
export const PRIZE_MANAGER_LABELS = {
  title: "Tournament prizes",
  intro: "Declare prizes for this tournament. Categories are yours to define — decide placements, amounts and sponsors for your league.",
  categoryName: "Prize category",
  categoryNamePlaceholder: "e.g. Winner, Best Batter",
  placement: "Placement (optional)",
  placementPlaceholder: "e.g. 1st place",
  amount: "Amount (optional)",
  amountPlaceholder: "e.g. 50000.00",
  currency: "Currency",
  sponsor: "Sponsor (optional)",
  sponsorPlaceholder: "e.g. MalikTech",
  save: "Add prize",
  saveEdit: "Save draft changes",
  saveCorrection: "Save correction draft",
  editDraft: "Edit draft",
  correct: "Correct",
  correctingNotice: "Corrections never edit the frozen record — your changes become a new draft and the approved prize is marked superseded. Approve the draft to make the correction public.",
  successCorrected: "Correction draft saved — approve it to replace the frozen record",
  cancelEdit: "Cancel edit",
  saving: "Saving…",
  approve: "Approve",
  approving: "Approving…",
  payout: "Record payout",
  recordingPayout: "Recording…",
  payoutReference: "Payout reference (optional)",
  payoutReferencePlaceholder: "e.g. bank slip #123",
  payoutNote: "Payout note (optional)",
  recordPayout: "Save payout record",
  draftBadge: "Draft",
  approvedBadge: "Approved — frozen",
  nonCash: "Non-cash prize",
  payoutRecordedLabel: "Payout recorded by the league",
  payoutNotRecordedLabel: "Payout not recorded",
  payoutTruth: "Recording a payout stores that the league made it. The platform does not verify payments.",
  frozenNotice: "Approved prizes are frozen records — take care before approving.",
  empty: "No prizes yet. Add the first prize above.",
  successDraft: "Prize saved as a draft",
  successDraftEdit: "Draft updated",
  successApprove: "Prize approved — it is now public and frozen",
  successApproveUnchanged: "This prize is already approved",
  successPayout: "Payout recorded",
  successPayoutUnchanged: "This payout is already recorded identically",
  failure: "The action could not be completed",
  incompleteAmount: "Enter an amount to save, or clear it for a non-cash prize.",
} as const

/** Currency options offered in the management card (default PKR). */
export const PRIZE_CURRENCY_OPTIONS = ["PKR", "USD", "GBP", "EUR", "AED"] as const

/** Truthful amount label: exact 2dp string straight from the numeric column. */
export function prizeAmountLabel(amount: string | null, currency: string): string {
  return amount === null ? PRIZE_MANAGER_LABELS.nonCash : `${currency} ${amount}`
}

/** Status badge text for a prize row. */
export function prizeStatusBadge(status: "draft" | "approved"): string {
  return status === "draft" ? PRIZE_MANAGER_LABELS.draftBadge : PRIZE_MANAGER_LABELS.approvedBadge
}

/** Payout state label for a prize row — "recorded", never "verified". */
export function prizePayoutLabel(recordedPayoutAt: Date | string | null): string {
  return recordedPayoutAt === null
    ? PRIZE_MANAGER_LABELS.payoutNotRecordedLabel
    : PRIZE_MANAGER_LABELS.payoutRecordedLabel
}

const DRAFT_BADGE = {
  draft: "outline" as const,
  approved: "default" as const,
}

function PrizeRow({ tournamentId, prize, onEditDraft, onCorrectApproved }: { tournamentId: string; prize: PrizeManagementRow; onEditDraft?: (prize: PrizeManagementRow) => void; onCorrectApproved?: (prize: PrizeManagementRow) => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutReference, setPayoutReference] = useState("")
  const [payoutNote, setPayoutNote] = useState("")

  const approve = () => {
    startTransition(async () => {
      try {
        const result = await approvePrize({ tournamentId, prizeId: prize.id })
        toast.success(result.changed ? PRIZE_MANAGER_LABELS.successApprove : PRIZE_MANAGER_LABELS.successApproveUnchanged)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : PRIZE_MANAGER_LABELS.failure)
      }
    })
  }

  const recordPayoutRecord = () => {
    startTransition(async () => {
      try {
        const result = await recordPayout({
          tournamentId,
          prizeId: prize.id,
          payoutReference: payoutReference.trim() ? payoutReference.trim() : null,
          payoutNote: payoutNote.trim() ? payoutNote.trim() : null,
        })
        toast.success(result.changed ? PRIZE_MANAGER_LABELS.successPayout : PRIZE_MANAGER_LABELS.successPayoutUnchanged)
        setPayoutOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : PRIZE_MANAGER_LABELS.failure)
      }
    })
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{prize.categoryName}</span>
        <Badge variant={DRAFT_BADGE[prize.status]} className="text-[10px]">{prizeStatusBadge(prize.status)}</Badge>
      </div>
      <p className="text-sm mt-1">
        {prizeAmountLabel(prize.amount, prize.currency)}
        {prize.placement ? <span className="text-muted-foreground"> · {prize.placement}</span> : null}
        {prize.sponsor ? <span className="text-muted-foreground"> · Sponsored by {prize.sponsor}</span> : null}
      </p>
      <p className="text-xs mt-1 text-muted-foreground">{prizePayoutLabel(prize.recordedPayoutAt)}</p>
      {prize.status === "draft" && (
        <div className="mt-2 flex justify-end gap-2">
          {onEditDraft && (
            <Button size="sm" variant="ghost" onClick={() => onEditDraft(prize)}>
              {PRIZE_MANAGER_LABELS.editDraft}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={approve} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : PRIZE_MANAGER_LABELS.approve}
          </Button>
        </div>
      )}
      {prize.status === "approved" && (
        <div className="mt-2">
          {onCorrectApproved && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => onCorrectApproved(prize)}>
                {PRIZE_MANAGER_LABELS.correct}
              </Button>
            </div>
          )}
          {prize.recordedPayoutAt === null && (
            <div className="mt-2 space-y-2">
              <p role="note" className="text-xs text-muted-foreground">{PRIZE_MANAGER_LABELS.payoutTruth}</p>
              {!payoutOpen ? (
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setPayoutOpen(true)} disabled={isPending}>
                    {PRIZE_MANAGER_LABELS.payout}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <Label htmlFor={`payout-reference-${prize.id}`}>{PRIZE_MANAGER_LABELS.payoutReference}</Label>
                    <Input id={`payout-reference-${prize.id}`} value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} placeholder={PRIZE_MANAGER_LABELS.payoutReferencePlaceholder} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor={`payout-note-${prize.id}`}>{PRIZE_MANAGER_LABELS.payoutNote}</Label>
                    <Input id={`payout-note-${prize.id}`} value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} className="mt-1.5" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPayoutOpen(false)} disabled={isPending}>Cancel</Button>
                    <Button size="sm" onClick={recordPayoutRecord} disabled={isPending}>
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : PRIZE_MANAGER_LABELS.recordPayout}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PrizeManagementCard({ tournamentId, context }: {
  tournamentId: string
  context: PrizeManagementContext
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingPrizeId, setEditingPrizeId] = useState<string | null>(null)
  const [correctingPrizeId, setCorrectingPrizeId] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState("")
  const [placement, setPlacement] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState("PKR")
  const [sponsor, setSponsor] = useState("")

  const trimmedCategory = categoryName.trim()
  const amountTrimmed = amount.trim()
  const amountWithoutSeparator = amountTrimmed.replace(/,/g, "")
  const amountLooksNumeric = amountTrimmed === "" || /^-?\d+(\.\d{1,2})?$/.test(amountWithoutSeparator)
  const canSubmit = trimmedCategory !== "" && amountLooksNumeric && !isPending

  const loadValues = (prize: PrizeManagementRow) => {
    setCategoryName(prize.categoryName)
    setPlacement(prize.placement ?? "")
    setAmount(prize.amount ?? "")
    setCurrency(prize.currency)
    setSponsor(prize.sponsor ?? "")
  }

  const loadDraftForEdit = (prize: PrizeManagementRow) => {
    setEditingPrizeId(prize.id)
    setCorrectingPrizeId(null)
    loadValues(prize)
  }

  const correctApproved = (prize: PrizeManagementRow) => {
    setCorrectingPrizeId(prize.id)
    setEditingPrizeId(null)
    loadValues(prize)
  }

  const cancelEdit = () => {
    setEditingPrizeId(null)
    setCorrectingPrizeId(null)
    setCategoryName("")
    setPlacement("")
    setAmount("")
    setSponsor("")
  }

  const save = () => {
    if (!canSubmit) return
    startTransition(async () => {
      try {
        await savePrize({
          tournamentId,
          // A draft edit targets the draft; a correction supersede-chains from
          // the frozen approved row to a NEW draft.
          ...(editingPrizeId ? { prizeId: editingPrizeId } : {}),
          ...(correctingPrizeId ? { prizeId: correctingPrizeId, supersede: true } : {}),
          categoryName: trimmedCategory,
          placement: placement.trim() ? placement.trim() : null,
          amount: amountTrimmed === "" ? null : amountWithoutSeparator,
          // The writer refuses a currency without an amount — keep them paired.
          currency: amountTrimmed === "" ? null : currency,
          sponsor: sponsor.trim() ? sponsor.trim() : null,
        })
        toast.success(
          correctingPrizeId ? PRIZE_MANAGER_LABELS.successCorrected
          : editingPrizeId ? PRIZE_MANAGER_LABELS.successDraftEdit
          : PRIZE_MANAGER_LABELS.successDraft,
        )
        setEditingPrizeId(null)
        setCorrectingPrizeId(null)
        setCategoryName("")
        setPlacement("")
        setAmount("")
        setSponsor("")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : PRIZE_MANAGER_LABELS.failure)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Trophy className="h-4 w-4" />{PRIZE_MANAGER_LABELS.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{PRIZE_MANAGER_LABELS.intro}</p>
        <p role="note" className="text-xs text-muted-foreground">{PRIZE_MANAGER_LABELS.frozenNotice}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="prize-category">{PRIZE_MANAGER_LABELS.categoryName}</Label>
            <Input id="prize-category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder={PRIZE_MANAGER_LABELS.categoryNamePlaceholder} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="prize-placement">{PRIZE_MANAGER_LABELS.placement}</Label>
            <Input id="prize-placement" value={placement} onChange={(event) => setPlacement(event.target.value)} placeholder={PRIZE_MANAGER_LABELS.placementPlaceholder} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="prize-amount">{PRIZE_MANAGER_LABELS.amount}</Label>
            <Input id="prize-amount" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={PRIZE_MANAGER_LABELS.amountPlaceholder} className="mt-1.5" inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="prize-currency">{PRIZE_MANAGER_LABELS.currency}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="prize-currency" className="mt-1.5">
                <SelectValue placeholder={PRIZE_MANAGER_LABELS.currency} />
              </SelectTrigger>
              <SelectContent>
                {PRIZE_CURRENCY_OPTIONS.map((code) => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="prize-sponsor">{PRIZE_MANAGER_LABELS.sponsor}</Label>
            <Input id="prize-sponsor" value={sponsor} onChange={(event) => setSponsor(event.target.value)} placeholder={PRIZE_MANAGER_LABELS.sponsorPlaceholder} className="mt-1.5" />
          </div>
        </div>
        {correctingPrizeId && (
          <p role="alert" className="text-sm text-amber-600">{PRIZE_MANAGER_LABELS.correctingNotice}</p>
        )}
        {!amountLooksNumeric && (
          <p role="alert" className="text-sm text-amber-600">{PRIZE_MANAGER_LABELS.incompleteAmount}</p>
        )}

        <div className="flex justify-end gap-2">
          {editingPrizeId && (
            <Button variant="ghost" onClick={cancelEdit} disabled={isPending}>
              {PRIZE_MANAGER_LABELS.cancelEdit}
            </Button>
          )}
          <Button onClick={save} disabled={!canSubmit}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : correctingPrizeId ? PRIZE_MANAGER_LABELS.saveCorrection : editingPrizeId ? PRIZE_MANAGER_LABELS.saveEdit : PRIZE_MANAGER_LABELS.save}
          </Button>
        </div>

        <div className="border-t pt-4 space-y-2">
          {context.prizes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{PRIZE_MANAGER_LABELS.empty}</p>
          ) : (
            <>
              {context.prizes.map((prize) => (
                <PrizeRow key={prize.id} tournamentId={tournamentId} prize={prize} onEditDraft={loadDraftForEdit} onCorrectApproved={correctApproved} />
              ))}
              {!context.complete && (
                <p role="note" className="text-xs text-muted-foreground">
                  Showing the first {context.prizes.length} prizes of this tournament.
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
