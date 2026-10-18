"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Loader2, Award } from "lucide-react"
import { declareAward, revokeAwardAction } from "@/app/actions/awards"
import { AWARD_CATEGORIES, AWARD_CATEGORY_LABELS, type AwardCategory } from "@mtk/database/lib/award-policy"
import type { AwardDeclarationContext } from "@/lib/award-records"

/**
 * Verbatim UI copy for the organizer award-declaration control (Batch 89).
 * Extracted as pure constants so tests assert exactly what the organizer sees.
 */
export const AWARD_MANAGER_LABELS = {
  title: "Official awards",
  intro: "Declare this tournament's official honors. Corrections supersede the previous decision and stay auditable — nothing is ever deleted.",
  category: "Award category",
  winnerType: "Winner type",
  winner: "Winner",
  citation: "Citation (optional)",
  playerType: "A player",
  teamType: "A team",
  submit: "Record official award",
  submitting: "Recording…",
  holdersTitle: "Current holders",
  holdersEmpty: "No official awards declared yet for this tournament.",
  supersedeNotice: "Recording this will supersede the current holder.",
  incompleteWarning: "The team list or roster may be incomplete (display is bounded). Verify the winner before recording.",
  noPlayers: "No players are available yet — declare after teams register players.",
  noTeams: "No registered teams yet.",
  successChanged: "Official award recorded",
  successUnchanged: "This award is already recorded — nothing changed",
  failure: "Failed to record the award",
  revoke: "Revoke",
  revokeConfirm: "Confirm revoke",
  revokeNotice: "Revoking withdraws the award entirely — no successor is declared. The gallery will stop showing it and the decision stays auditable.",
  revokeSuccess: "Official award revoked",
  revokeUnchanged: "This award is already superseded — nothing revoked",
  revokeFailure: "Failed to revoke the award",
} as const

/** A brief winner label for the holders list, when a name could not resolve. */
const HOLDER_UNAVAILABLE = "Holder record unavailable"

export function AwardDeclarationCard({ tournamentId, context }: {
  tournamentId: string
  context: AwardDeclarationContext
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [category, setCategory] = useState("")
  const [winnerType, setWinnerType] = useState<"player" | "team" | "">("")
  const [playerId, setPlayerId] = useState("")
  const [teamId, setTeamId] = useState("")
  const [citation, setCitation] = useState("")
  // Two-step confirm per holder row: the first click asks, the second revokes.
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)

  const activeForCategory = context.activeAwards.find((award) => award.category === category)
  const winnerMissing = winnerType === "player" ? playerId === "" : teamId === ""
  const canSubmit = category !== "" && winnerType !== "" && !winnerMissing

  const record = () => {
    if (!canSubmit) return
    startTransition(async () => {
      try {
        const result = await declareAward({
          tournamentId,
          category,
          ...(winnerType === "player" ? { playerId, teamId: null } : { teamId, playerId: null }),
          citation: citation.trim() ? citation.trim() : null,
        })
        toast.success(result.changed ? AWARD_MANAGER_LABELS.successChanged : AWARD_MANAGER_LABELS.successUnchanged)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : AWARD_MANAGER_LABELS.failure)
      }
    })
  }

  const revoke = (awardId: string) => {
    startTransition(async () => {
      try {
        const result = await revokeAwardAction({ tournamentId, awardId })
        toast.success(result.revoked ? AWARD_MANAGER_LABELS.revokeSuccess : AWARD_MANAGER_LABELS.revokeUnchanged)
        setRevokeTarget(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : AWARD_MANAGER_LABELS.revokeFailure)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Award className="h-4 w-4" />{AWARD_MANAGER_LABELS.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{AWARD_MANAGER_LABELS.intro}</p>

        {(!context.teamsComplete || !context.playersComplete) && (
          <p role="alert" className="text-sm text-amber-600">{AWARD_MANAGER_LABELS.incompleteWarning}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="award-category">{AWARD_MANAGER_LABELS.category}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="award-category" className="mt-1.5">
                <SelectValue placeholder={AWARD_MANAGER_LABELS.category} />
              </SelectTrigger>
              <SelectContent>
                {AWARD_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>{AWARD_CATEGORY_LABELS[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="award-winner-type">{AWARD_MANAGER_LABELS.winnerType}</Label>
            <Select value={winnerType} onValueChange={(value) => setWinnerType(value as "player" | "team" | "")}>
              <SelectTrigger id="award-winner-type" className="mt-1.5">
                <SelectValue placeholder={AWARD_MANAGER_LABELS.winnerType} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="player">{AWARD_MANAGER_LABELS.playerType}</SelectItem>
                <SelectItem value="team">{AWARD_MANAGER_LABELS.teamType}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {winnerType === "player" && (
          <div>
            <Label htmlFor="award-player">{AWARD_MANAGER_LABELS.winner}</Label>
            {context.players.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">{AWARD_MANAGER_LABELS.noPlayers}</p>
            ) : (
              <Select value={playerId} onValueChange={setPlayerId}>
                <SelectTrigger id="award-player" className="mt-1.5">
                  <SelectValue placeholder={AWARD_MANAGER_LABELS.winner} />
                </SelectTrigger>
                <SelectContent>
                  {context.players.map((player) => (
                    <SelectItem key={player.id} value={player.id}>{player.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
        {winnerType === "team" && (
          <div>
            <Label htmlFor="award-team">{AWARD_MANAGER_LABELS.winner}</Label>
            {context.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">{AWARD_MANAGER_LABELS.noTeams}</p>
            ) : (
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="award-team" className="mt-1.5">
                  <SelectValue placeholder={AWARD_MANAGER_LABELS.winner} />
                </SelectTrigger>
                <SelectContent>
                  {context.teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="award-citation">{AWARD_MANAGER_LABELS.citation}</Label>
          <Textarea id="award-citation" value={citation} onChange={(event) => setCitation(event.target.value)} className="mt-1.5" rows={3} />
        </div>

        {activeForCategory && (
          <p role="alert" className="text-sm text-amber-600">
            {AWARD_MANAGER_LABELS.supersedeNotice}
            {" "}{AWARD_CATEGORY_LABELS[activeForCategory.category as AwardCategory] ?? activeForCategory.category}
            {": "}{activeForCategory.holderName ?? HOLDER_UNAVAILABLE}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={record} disabled={!canSubmit || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : AWARD_MANAGER_LABELS.submit}
          </Button>
        </div>

        <div className="border-t pt-4">
          <span className="text-sm font-semibold">{AWARD_MANAGER_LABELS.holdersTitle}</span>
          <p className="text-xs text-muted-foreground mt-1">{AWARD_MANAGER_LABELS.revokeNotice}</p>
          {context.activeAwards.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-1">{AWARD_MANAGER_LABELS.holdersEmpty}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {context.activeAwards.map((award) => (
                <li key={award.id} data-testid="active-award-holder" className="text-sm">
                  <span className="font-medium">{AWARD_CATEGORY_LABELS[award.category as AwardCategory] ?? award.category}</span>
                  {" — "}{award.holderName ?? HOLDER_UNAVAILABLE}
                  {award.citation ? <span className="text-muted-foreground"> · {award.citation}</span> : null}
                  <span className="ml-2 inline-flex gap-1">
                    {revokeTarget === award.id ? (
                      <Button
                        size="sm" variant="destructive" className="h-6 text-xs"
                        disabled={isPending}
                        onClick={() => revoke(award.id)}
                      >
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : AWARD_MANAGER_LABELS.revokeConfirm}
                      </Button>
                    ) : (
                      <Button
                        size="sm" variant="outline" className="h-6 text-xs"
                        disabled={isPending}
                        onClick={() => setRevokeTarget(award.id)}
                      >
                        {AWARD_MANAGER_LABELS.revoke}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
