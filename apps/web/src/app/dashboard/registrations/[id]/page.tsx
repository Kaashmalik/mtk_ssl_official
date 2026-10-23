import React from "react"
import Link from "next/link"
import { and, eq } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { ArrowLeft } from "lucide-react"
import { auth } from "@clerk/nextjs/server"
import { db, teams, users } from "@mtk/database"
import { teamManagementGrant } from "@mtk/database/lib/resource-grants"
import { resolveRegistrationReviewAccess, readRegistrationDetail } from "@/lib/registration-reads"
import { resolveActiveTenantId } from "@/lib/rbac-server"
import { describeEligibility, evaluateSquadEligibility } from "@mtk/database/lib/registration-eligibility-policy"
import { unstable_noStore as noStore } from "next/cache"

/**
 * ENH-05-03 slice 6: one registration's detail, readable by the review
 * console cast (registration:manage) OR the entry's own team pointer grant —
 * the SAME allowlist every write path revalidates (authority never comes
 * from role text alone). Any other member is redirected to the dashboard
 * rather than reading another team's entry. The projection from the read is
 * already bounded: no payment transaction references, no actor/approver
 * UUIDs — status, fee, squad NAMES and timestamps only.
 */
export default async function RegistrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Authority: review console cast first; otherwise the entry's team grant.
  const reviewer = await resolveRegistrationReviewAccess()
  const tenantId = reviewer?.tenantId ?? await resolveActiveTenantId()
  if (!tenantId) redirect("/dashboard")
  const detail = await readRegistrationDetail(tenantId, id)
  if (!detail) notFound()
  if (!reviewer) {
    const actor = await db.query.users.findFirst({ where: eq(users.clerkId, userId) })
    const [team] = actor ? await db.select({ managerId: teams.managerId, captainId: teams.captainId })
      .from(teams).where(and(eq(teams.id, detail.teamId), eq(teams.tenantId, tenantId))).limit(1) : []
    if (!actor || !team || !teamManagementGrant(team, actor.id)) redirect("/dashboard")
  }

  const eligible = describeEligibility(evaluateSquadEligibility({
    approvalStatus: String(detail.status ?? "pending"),
    paymentStatus: String(detail.paymentStatus ?? "unpaid"),
    squadSize: (detail.squadPlayerIds ?? []).length,
    minSquadSize: -1,
  }))
  const squadNames = new Map((detail.squad ?? []).map(member => [member.id, member.name] as const))

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/registrations">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to registrations</Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2">{detail.teamName ?? "TBD Team"}</h1>
        <p className="text-muted-foreground">{detail.tournamentName ?? "TBD Tournament"}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Entry status</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-2">
            <Badge variant="outline" className="capitalize">{String(detail.status ?? "pending")}</Badge>
            <Badge variant="outline" className="capitalize">{String(detail.paymentStatus ?? "unpaid")}</Badge>
          </div>
          <p role="status" className="text-muted-foreground">{eligible}</p>
          {detail.rejectionReason ? (
            <p className="text-destructive">Rejection reason: {detail.rejectionReason}</p>
          ) : null}
          <p>Registration fee: PKR {Number(detail.registrationFee || 0).toLocaleString()}</p>
          <div>
            <p className="font-medium mb-1">Registered squad ({(detail.squadPlayerIds ?? []).length})</p>
            <ul className="list-disc pl-5">
              {(detail.squadPlayerIds ?? []).map(memberId => (
                <li key={memberId}>{squadNames.get(memberId) ?? "Unknown member"}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
