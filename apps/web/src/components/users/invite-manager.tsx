"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Copy, UserPlus } from "lucide-react"
import { createInvite, getInvites, revokeInvite } from "@/app/actions/users-invites"
import { getTeams } from "@/app/actions/teams"

interface InviteRow {
  id: string
  email: string
  role: string
  status: string
  teamId: string | null
  expiresAt: Date | string
  createdAt: Date | string
}

const ROLE_LABELS: Record<string, string> = {
  team_manager: "Team Manager",
  coach: "Coach",
  scorer: "Scorer",
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  accepted: "bg-green-600 text-white",
  revoked: "bg-muted text-muted-foreground",
  expired: "bg-red-600 text-white",
}

export function InviteManager() {
  const [rows, setRows] = useState<InviteRow[]>([])
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("team_manager")
  const [teamId, setTeamId] = useState("none")
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    try {
      const [invites, teamList] = await Promise.all([getInvites(), getTeams({ page: 1, pageSize: 100, sortBy: "name", sortOrder: "asc" })])
      setRows(invites as unknown as InviteRow[])
      const list = (teamList as unknown as { data?: { id: string; name: string }[] })?.data ?? []
      setTeams(list)
    } catch {
      /* not authorised */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const submit = () =>
    startTransition(async () => {
      try {
        const res = await createInvite({
          email,
          role: role as "team_manager" | "coach" | "scorer",
          teamId: teamId === "none" ? null : teamId,
        })
        setLastLink(res.link)
        setEmail("")
        // The invite is valid and the link is shown below either way; this only
        // tells the owner whether to expect the email to arrive.
        if (res.emailDelivered) {
          toast.success("Invitation created and emailed")
        } else {
          toast.success("Invitation created — email could not be sent, copy the link below")
        }
        await refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create invitation")
      }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" /> Invite Team Staff
        </CardTitle>
        <CardDescription>
          Send a single-use invite link to a team manager, coach, or scorer. The link expires in 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team_manager">Team Manager</SelectItem>
                <SelectItem value="coach">Coach</SelectItem>
                <SelectItem value="scorer">Scorer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Whole league</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={submit} disabled={isPending || !email}>
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
                await navigator.clipboard.writeText(lastLink)
                toast.success("Link copied")
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy link
            </Button>
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
                      {new Date(r.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right">
                      {r.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            startTransition(async () => {
                              try {
                                await revokeInvite(r.id)
                                toast.success("Invitation revoked")
                                await refresh()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed to revoke")
                              }
                            })
                          }
                        >
                          Revoke
                        </Button>
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