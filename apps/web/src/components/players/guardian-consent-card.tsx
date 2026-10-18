"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { setGuardianConsent, withdrawGuardianConsent } from "@/app/actions/players"
import { MINOR_CONSENT_LABELS } from "@mtk/database/lib/minor-consent-policy"

/**
 * Minor guardian consent management (Batch 132, PUB-06 + REG-06). Owner-only
 * card on the player edit page: shows whether the recorded date of birth
 * makes this player a minor and whether guardian consent is recorded. The
 * writer is the authority - permission, the minor proof, lock and audit all
 * live there; replay saves answer honestly ("Nothing changed").
 */
export function GuardianConsentCard({ playerId, dateOfBirth, guardianName, guardianConsentAt, isOwner }: {
  playerId: string
  dateOfBirth: string | null
  guardianName: string | null
  guardianConsentAt: Date | string | null
  isOwner: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(guardianName ?? "")

  const minor = MINOR_CONSENT_LABELS.minor
  const recorded = guardianConsentAt != null
  const age = dateOfBirth ? ageAt(dateOfBirth) : null
  const isMinor = age !== null && age < 18

  const save = () => {
    startTransition(async () => {
      try {
        const result = await setGuardianConsent(playerId, { guardianName: name })
        toast.success(result.changed ? "Guardian consent recorded" : "Nothing changed - already recorded")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to record guardian consent")
      }
    })
  }

  const withdraw = () => {
    startTransition(async () => {
      try {
        const result = await withdrawGuardianConsent(playerId)
        toast.success(result.changed ? "Guardian consent withdrawn - public records withheld again" : "Nothing changed - no consent recorded")
        setName("")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to withdraw guardian consent")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guardian consent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{MINOR_CONSENT_LABELS.disclosure}</p>
        <p className="text-sm" data-testid="minor-status">
          {age === null
            ? MINOR_CONSENT_LABELS.unknownAge
            : isMinor ? minor : `${MINOR_CONSENT_LABELS.adult} (${age})`}
        </p>
        <p className="text-sm" data-testid="consent-status">
          {recorded
            ? `${MINOR_CONSENT_LABELS.consentRecorded}${guardianName ? ` - ${guardianName}` : ""}`
            : MINOR_CONSENT_LABELS.consentMissing}
        </p>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={MINOR_CONSENT_LABELS.guardianName}
              maxLength={120}
              disabled={isPending}
              aria-label={MINOR_CONSENT_LABELS.guardianName}
            />
            <Button variant="outline" size="sm" onClick={save} disabled={isPending || name.trim().length < 2}>
              {MINOR_CONSENT_LABELS.saveTitle}
            </Button>
            {recorded && (
              <Button variant="outline" size="sm" onClick={withdraw} disabled={isPending}>
                {MINOR_CONSENT_LABELS.withdrawTitle}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ageAt(dateOfBirth: string): number {
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(dob.getTime())) return NaN
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday = now.getUTCMonth() < dob.getUTCMonth()
    || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}
