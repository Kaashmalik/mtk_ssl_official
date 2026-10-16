"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mtk/ui/components/ui/table"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@mtk/ui/components/ui/dialog"
import { Search, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { updateUserRole, toggleUserStatus, removeMember, type MemberRoleChange } from "@/app/actions/users"
import type { MemberAssignmentMap } from "@/lib/member-assignments"
import { membershipExpiryDisplay } from "@/lib/membership-display"

interface Member {
  id: string
  membershipId: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  status: "active" | "suspended"
  accountActive: boolean
  protectedAccess: boolean
  version: number
  createdAt: Date
  expiresAt?: string | Date | null
}

const ROLE_OPTIONS = [
  { value: "team_manager", label: "Team Manager" },
  { value: "coach", label: "Coach" },
  { value: "scorer", label: "Scorer" },
  { value: "player", label: "Player" },
  { value: "fan", label: "Fan" },
] as const

/** Human summary of the operational assignments that block a removal. */
function describeAssignments(assignments?: MemberAssignmentMap[string]): string[] {
  if (!assignments) return []
  const parts: string[] = []
  if (assignments.managedTeams.length > 0) parts.push(`manages ${assignments.managedTeams.length} team${assignments.managedTeams.length === 1 ? "" : "s"}`)
  const scorer = assignments.scoringMatches.filter(match => match.role === "scorer").length
  const backup = assignments.scoringMatches.filter(match => match.role === "backup").length
  if (scorer > 0) parts.push(`scorer on ${scorer} match${scorer === 1 ? "" : "es"}`)
  if (backup > 0) parts.push(`backup scorer on ${backup} match${backup === 1 ? "" : "es"}`)
  return assignments.isComplete ? parts : parts.map(part => `At least: ${part}`)
}

export function UserListTable({ initialUsers, assignments = {}, directoryMode = false, currentUserId, tenantId, tenantName }: {
  initialUsers: Member[]; assignments?: MemberAssignmentMap; directoryMode?: boolean; currentUserId?: string | null; tenantId: string; tenantName: string
}) {
  const router = useRouter()
  const [members, setMembers] = useState(initialUsers)
  const [search, setSearch] = useState("")
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Member | null>(null)
  const [removal, setRemoval] = useState<Member | null>(null)
  const [notice, setNotice] = useState("")
  useEffect(() => { setMembers(initialUsers) }, [initialUsers])

  const save = async (member: Member, change: { role: MemberRoleChange["role"] } | { status: "active" | "suspended" }) => {
    if (updatingId) return
    setUpdatingId(member.membershipId)
    setNotice("Saving league membership…")
    try {
      const key = { tenantId, membershipId: member.membershipId, expectedVersion: member.version }
      const result = "role" in change ? await updateUserRole({ ...key, ...change }) : await toggleUserStatus({ ...key, ...change })
      // Only the confirmed server state updates the controlled select/status.
      setMembers(previous => previous.map(row => row.membershipId === result.member.membershipId ? { ...row, ...result.member } : row))
      setConfirmation(null)
      setNotice(`Membership saved in ${tenantName}.`)
      toast.success(`Membership saved in ${tenantName}`)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save membership. Reload and try again."
      setNotice(message)
      toast.error(message)
      // No local success, role change or status toggle on rejection/conflict.
      router.refresh()
    } finally { setUpdatingId(null) }
  }
  const remove = async (member: Member) => {
    if (updatingId) return
    setUpdatingId(member.membershipId)
    setNotice("Removing league membership…")
    try {
      await removeMember({ tenantId, membershipId: member.membershipId, expectedVersion: member.version })
      // Only drop the row after the server confirms the removal.
      setMembers(previous => previous.filter(row => row.membershipId !== member.membershipId))
      setRemoval(null)
      setNotice(`Membership removed from ${tenantName}.`)
      toast.success(`Membership removed from ${tenantName}`)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove membership. Reload and try again."
      setNotice(message)
      toast.error(message)
      // No local removal on rejection/conflict (e.g. an outstanding assignment).
      router.refresh()
    } finally { setUpdatingId(null) }
  }
  const filtered = members.filter(member => `${member.email} ${member.displayName ?? ""}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Active membership permits only this league's role. A suspended platform account stays blocked everywhere. Owner and self access are protected.</p>
      {!directoryMode && <div className="relative max-w-sm">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search loaded league members" placeholder="Search loaded members…" value={search} onChange={event => setSearch(event.target.value)} className="pl-9 min-h-11" />
      </div>}
      <p role="status" aria-live="polite" className="text-sm">{notice}</p>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Member</TableHead><TableHead>Email</TableHead><TableHead>Assignments</TableHead><TableHead>League role</TableHead><TableHead>League access</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map(member => {
              const protectedMember = member.protectedAccess || member.id === currentUserId || ["league_owner", "super_admin"].includes(member.role)
              const memberAssignments = assignments[member.id]
              const assignmentSummary = describeAssignments(memberAssignments)
              return <TableRow key={member.membershipId}>
                <TableCell><Link className="font-semibold underline min-h-11 inline-flex items-center" href={`/dashboard/settings/members/${member.membershipId}`}>{member.displayName || "No display name"}</Link><span className="block text-xs text-muted-foreground">Joined {new Date(member.createdAt).toLocaleDateString()}</span></TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>{!memberAssignments
                  ? <span className="text-xs text-muted-foreground">Assignments not loaded</span>
                  : <div className="space-y-2 text-xs">
                    {assignmentSummary.length === 0
                      ? <span className="text-muted-foreground">{memberAssignments.isComplete ? "None" : "No assignments in loaded results"}</span>
                      : <div className="flex flex-col gap-1 items-start">{assignmentSummary.map(part => <Badge key={part} variant="secondary">{part}</Badge>)}</div>}
                    {!memberAssignments.isComplete && <p className="text-muted-foreground">Partial assignment list. Additional assignments may block removal.</p>}
                    {assignmentSummary.length > 0 && <details>
                      <summary className="cursor-pointer min-h-11 flex items-center">View listed assignments for {member.displayName || member.email}</summary>
                      <ul className="space-y-1">
                        {memberAssignments.managedTeams.map(team => <li key={team.id}><Link className="underline inline-flex min-h-11 items-center" href={`/dashboard/teams/${team.id}`}>Manage team: {team.name}</Link></li>)}
                        {memberAssignments.scoringMatches.map(match => <li key={match.id}><Link className="underline inline-flex min-h-11 items-center" href={`/dashboard/matches/${match.id}`}>{match.role === "backup" ? "Backup scorer" : "Scorer"}: {match.matchNumber === null ? "Match" : `Match ${match.matchNumber}`} ({match.status.replaceAll("_", " ")})</Link></li>)}
                      </ul>
                    </details>}
                  </div>}
                </TableCell>
                <TableCell>{protectedMember ? <Badge variant="outline">{member.role.replaceAll("_", " ")}</Badge> :
                  <Select disabled={updatingId !== null} value={member.role} onValueChange={value => void save(member, { role: value as MemberRoleChange["role"] })}>
                    <SelectTrigger className="min-h-11 min-w-[150px]" aria-label={`League role for ${member.displayName || member.email}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>}
                </TableCell>
                <TableCell><Badge variant="outline">{member.status === "active" ? "Active in league" : "Suspended in league"}</Badge>
                  {!member.accountActive && <span className="block text-xs text-destructive">Platform account blocked</span>}
                  {(() => {
                    const expiry = membershipExpiryDisplay(member.expiresAt ?? null)
                    if (expiry.state === "unbounded") return null
                    return <span title={expiry.detail} className={`block text-xs ${expiry.state === "live" ? "text-muted-foreground" : "text-destructive"}`}>{expiry.short}</span>
                  })()}
                </TableCell>
                <TableCell className="text-right">{!protectedMember && <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" disabled={updatingId !== null} onClick={() => setConfirmation(member)}>
                    {updatingId === member.membershipId && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {member.status === "active" ? "Suspend in league" : "Reactivate in league"}
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11 text-destructive" disabled={updatingId !== null} onClick={() => setRemoval(member)}>
                    Remove
                  </Button>
                </div>}</TableCell>
              </TableRow>
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center">No league members match this search.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{directoryMode ? `Showing ${members.length} members on this page. Use directory search to search the whole league.` : "Showing up to 100 members in this league. Search applies to loaded members only."}</p>
      <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !updatingId) setConfirmation(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.status === "active" ? "Suspend league membership?" : "Reactivate league membership?"}</DialogTitle>
            <DialogDescription>
              This affects {confirmation?.displayName || confirmation?.email} in {tenantName} only.
              {confirmation?.status === "active" ? " New authorized scoring writes and administrative access will be blocked. Pending offline work is retained for review, not accepted automatically." : " Existing permitted league roles and assignments become usable again, unless the platform account is blocked."}
              {" "}No other league or global account is changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={updatingId !== null} onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button disabled={updatingId !== null} onClick={() => { if (confirmation) void save(confirmation, { status: confirmation.status === "active" ? "suspended" : "active" }) }}>{updatingId ? "Saving…" : "Confirm league change"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removal !== null} onOpenChange={open => { if (!open && !updatingId) setRemoval(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove league membership?</DialogTitle>
            <DialogDescription>
              This removes {removal?.displayName || removal?.email} from {tenantName} only. Their global account and any other league are unchanged, and historical match/statistics records are kept.
              {" "}Removal is refused while the member still manages a team or is assigned to a match — unassign those first.
              {removal && describeAssignments(assignments[removal.id]).length > 0 &&
                <span className="block mt-2 font-medium text-destructive">Listed blockers: {describeAssignments(assignments[removal.id]).join("; ")}.</span>}
              {removal && !assignments[removal.id]?.isComplete && <span className="block mt-2">Assignment information is incomplete or not loaded. The server checks all current assignments before removal.</span>}
              <span className="block mt-2">Assignments are rechecked on removal; this list is a snapshot.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={updatingId !== null} onClick={() => setRemoval(null)}>Cancel</Button>
            <Button variant="destructive" disabled={updatingId !== null} onClick={() => { if (removal) void remove(removal) }}>{updatingId ? "Removing…" : "Remove from league"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
