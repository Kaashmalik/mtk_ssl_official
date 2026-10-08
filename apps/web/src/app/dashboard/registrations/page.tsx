import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus } from "lucide-react"
import { getMyTenant } from "@/app/actions/tenants"
import { RegistrationList } from "@/components/registrations/registration-list"
import { db, leagueRegistrations, teams, tournaments } from "@mtk/database"
import { eq, desc, and } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

export default async function RegistrationsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const registrationsRaw = await db.select().from(leagueRegistrations)
    .where(eq(leagueRegistrations.tenantId, tenant.id))
    .orderBy(desc(leagueRegistrations.createdAt))

  const resolvedRegistrations = await Promise.all(registrationsRaw.map(async (reg) => {
    const [team] = await db.select({ name: teams.name }).from(teams)
      .where(and(eq(teams.id, reg.teamId), eq(teams.tenantId, tenant.id)))
      .limit(1)
    const [tournament] = await db.select({ name: tournaments.name }).from(tournaments)
      .where(and(eq(tournaments.id, reg.tournamentId), eq(tournaments.tenantId, tenant.id)))
      .limit(1)

    return {
      id: reg.id,
      teamName: team?.name ?? "TBD Team",
      tournamentName: tournament?.name ?? "TBD Tournament",
      squadCount: reg.squadPlayerIds ? reg.squadPlayerIds.length : 0,
      registrationFee: reg.registrationFee || "0",
      notes: reg.notes,
      status: reg.status || "pending",
      paymentStatus: reg.paymentStatus || "unpaid",
      createdAt: reg.createdAt,
    }
  }))

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
