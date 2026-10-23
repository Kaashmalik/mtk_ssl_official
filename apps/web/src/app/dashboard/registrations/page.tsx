import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus } from "lucide-react"
import { RegistrationList } from "@/components/registrations/registration-list"
import { resolveRegistrationReviewAccess, readRegistrations } from "@/lib/registration-reads"
import { describeEligibility, evaluateSquadEligibility } from "@mtk/database/lib/registration-eligibility-policy"
import { unstable_noStore as noStore } from "next/cache"

export default async function RegistrationsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Only league owners (registration:manage) reach the review queue; other members
  // are sent back to the dashboard rather than seeing another league's entries. A
  // tenant/membership/read failure is not a non-owner visit, so it is left to
  // propagate to this route's error boundary instead of a blanket redirect.
  const context = await resolveRegistrationReviewAccess()
  if (!context) redirect("/dashboard")

  const { data } = await readRegistrations(context.tenantId, { pageSize: 100 })
  const resolvedRegistrations = data.map((reg) => {
    const status = reg.status || "pending"
    const paymentStatus = reg.paymentStatus || "unpaid"
    const squadCount = reg.squadPlayerIds ? reg.squadPlayerIds.length : 0
    return {
      id: reg.id,
      teamName: reg.teamName ?? "TBD Team",
      tournamentName: reg.tournamentName ?? "TBD Tournament",
      squadCount,
      registrationFee: reg.registrationFee || "0",
      notes: reg.notes,
      status,
      paymentStatus,
      createdAt: reg.createdAt,
      // ENH-05-03 slice 3: the reviewer sees the SAME truthful sentence as the
      // team (shared policy). The tournament minimum squad size is not
      // configurable in the schema yet, so that blocker is shown, not hidden.
      eligibility: describeEligibility(evaluateSquadEligibility({
        approvalStatus: status, paymentStatus, squadSize: squadCount, minSquadSize: -1,
      })),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">League Registrations</h1>
          <p className="text-muted-foreground mt-1">
            Review and manage team registrations for your upcoming and active tournaments.
          </p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/registrations/new">
            <Button variant="gradient-shine">
              <Plus className="h-4 w-4 mr-2" />
              New Registration
            </Button>
          </Link>
        </MotionWrapper>
      </div>

      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <RegistrationList initialRegistrations={resolvedRegistrations} />
      </MotionWrapper>
    </div>
  )
}
