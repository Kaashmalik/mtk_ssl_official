"use client"

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useUser } from "@clerk/nextjs"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Copy, UserPlus } from "lucide-react"
import { createInvite, getInvites, resendInvite, revokeInvite } from "@/app/actions/users-invites"
import { getTeams } from "@/app/actions/teams"
import { computeMembershipBound, formatMembershipBound, invitationBoundPresets } from "@/lib/invite-expiry-options"

interface InviteRow {
  id: string
  email: string
  role: string
  status: string
  teamId: string | null
  expiresAt: Date | string
  membershipExpiresAt?: Date | string | null
  createdAt: Date | string
  emailState: string | null
  emailAttemptedAt: Date | string | null
}

const ROLE_LABELS: Record<string, string> = {
  team_manager: "Team Manager",
  captain: "Captain",
  coach: "Coach",
  scorer: "Scorer",
  player: "Player",
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  accepted: "bg-green-600 text-white",
  revoked: "bg-muted text-muted-foreground",
  expired: "bg-red-600 text-white",
}

/** Provider state, never a delivery guarantee except the webhook-reported events. */
const DELIVERY_LABEL: Record<string, string> = {
  unconfigured: "Email not configured",
  provider_accepted: "Provider accepted (delivery unconfirmed)",
  delivered: "Delivered",
  bounced: "Bounced — not delivered",
  complained: "Marked as spam",
  failed: "Provider rejected",
  unknown: "Outcome unknown",
}

function deliveryToast(state: string): string {
  if (state === "provider_accepted") return "Email provider accepted it; delivery is not confirmed"
  if (state === "unknown") return "Email outcome is unknown. Use the link; do not assume delivery."
  return "Email is unconfigured or rejected. Copy the link below."
}

export function InviteManager({ tenantId }: { tenantId: string }) {
  const { user } = useUser()
  const identityKey = `${tenantId}/${user?.id}`
  const currentIdentity = useRef(identityKey)
  currentIdentity.current = identityKey
  const [rows, setRows] = useState<InviteRow[]>([])
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("team_manager")
  const [teamId, setTeamId] = useState("none")
  const [bound, setBound] = useState("none")
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    try {
      const [invites, teamList] = await Promise.all([getInvites(tenantId), getTeams({ page: 1, pageSize: 100, sortBy: "name", sortOrder: "asc" })])
      if (currentIdentity.current !== identityKey) return
      setLoadError(null)
      setRows(invites as unknown as InviteRow[])
      const list = (teamList as unknown as { data?: { id: string; name: string }[] })?.data ?? []
      setTeams(list)
    } catch {
      if (currentIdentity.current !== identityKey) return
      setRows([])
      setTeams([])
      setLastLink(null)
      setLoadError("Unable to load invitations in this workspace. Reload before making changes.")
    }
  }, [tenantId, identityKey])

  useEffect(() => {
    setRows([])
    setLastLink(null)
    refresh()
  }, [refresh, user?.id])

  const submit = () =>
    startTransition(async () => {
      try {
        const res = await createInvite({
          tenantId,
          email,
          role: role as "team_manager" | "captain" | "coach" | "scorer" | "player",
          teamId: teamId === "none" ? null : teamId,
          membershipExpiresAt: computeMembershipBound(bound)?.toISOString() ?? null,
        })
        if (currentIdentity.current !== identityKey) return
        setLastLink(res.link)
        setEmail("")
        setBound("none")
        if (res.emailState === "provider_accepted") {
          toast.success("Invitation created — email provider accepted it; delivery is not confirmed")
        } else if (res.emailState === "unknown") {
          toast.success("Invitation saved — email outcome is unknown. Use the link; do not assume delivery.")
        } else {
          toast.success("Invitation saved — email is unconfigured or rejected. Copy the link below.")
        }
        await refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create invitation")
      }
    })

  const resend = (invite: InviteRow) =>
    startTransition(async () => {
      try {
        const res = await resendInvite({ tenantId, inviteId: invite.id })
        if (currentIdentity.current !== identityKey) return
        setLastLink(res.link)
        toast.success(`Invitation resent — ${deliveryToast(res.emailState)}`)
        await refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to resend invitation")
      }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" /> Invite Team Staff
        </CardTitle>
        <CardDescription>
          Invite a team manager, captain, coach, scorer, or player. Verify the invited email through the sign-in provider before acceptance. Links expire in 7 days. The delivery column shows the last provider outcome — acceptance is not proof of delivery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              className="mt-1.5"
              placeholder="manager@team.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select disabled={isPending} value={role} onValueChange={value => { setRole(value); setTeamId("none") }}>
              <SelectTrigger className="mt-1.5" aria-label="Invited league role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team_manager">Team Manager</SelectItem>
                <SelectItem value="captain">Captain</SelectItem>
                <SelectItem value="coach">Coach</SelectItem>
                <SelectItem value="scorer">Scorer</SelectItem>
                <SelectItem value="player">Player</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(role === "team_manager" || role === "captain") && <div>
            <Label>Team</Label>
            <Select disabled={isPending} value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="mt-1.5" aria-label="Team for the invited manager or captain"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
          <div>
            <Label>Membership bound</Label>
            <Select disabled={isPending} value={bound} onValueChange={setBound}>
              <SelectTrigger className="mt-1.5" aria-label="Membership bound for the invited member"><SelectValue /></SelectTrigger>
              <SelectContent>
                {invitationBoundPresets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">The membership bound is separate from the link expiry: it bounds the accepted member's league access itself and must be extended by an owner to last longer. A bound is applied at acceptance with you recorded as the granting owner; no bound leaves access unbounded.</p>
        <p className="text-xs text-muted-foreground">Coach and scorer invitations grant a league role only. Scorers still need an explicit match assignment. Team-scoped coach/scorer grants are not available. Captain invitations require a team and assign its captain pointer on acceptance; player invitations grant a league role and stay unteammed until the roster adds them.</p>
        <Button onClick={submit} disabled={isPending || !!loadError || !email || ((role === "team_manager" || role === "captain") && teamId === "none")}>
          {isPending ? "Creating..." : "Create Invitation"}
        </Button>

        {lastLink && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-2">
            <p className="text-sm font-medium">Invite link created</p>
            <p className="text-xs text-muted-foreground break-all">{lastLink}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(lastLink)
                  toast.success("Link copied — share only with the invited recipient")
                } catch { toast.error("Clipboard access failed. Copy the link manually.") }
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy link
            </Button>
            <p className="text-xs text-muted-foreground">Secret link shown once. If lost, revoke the pending invitation and create a replacement; this invalidates the old link.</p>
            <Button size="sm" variant="ghost" onClick={() => setLastLink(null)}>Hide link</Button>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Role</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Delivery</th>
                  <th className="py-2 text-left font-medium">Expires</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{r.email}</td>
                    <td className="py-2">{ROLE_LABELS[r.role] ?? r.role}</td>
                    <td className="py-2">
                      <Badge className={STATUS_BADGE[r.status] ?? "bg-muted"}>{r.status}</Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.emailState ? DELIVERY_LABEL[r.emailState] ?? r.emailState : "Not attempted"}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(r.expiresAt).toLocaleDateString()}
                      {r.membershipExpiresAt && <span className="block">Access bound: {formatMembershipBound(r.membershipExpiresAt)}</span>}
                    </td>
                    <td className="py-2 text-right">
                      {r.status === "pending" && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => resend(r)}
                          >
                            Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              startTransition(async () => {
                                try {
                                  const result = await revokeInvite({ tenantId, inviteId: r.id })
                                  setLastLink(null)
                                  // Classified replay: an ALREADY-revoked invite replays as a
                                  // pure read (changed: false) — say so instead of claiming a write.
                                  toast.success(result.changed ? "Invitation revoked" : "This invitation was already revoked")
                                  await refresh()
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Failed to revoke")
                                }
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
