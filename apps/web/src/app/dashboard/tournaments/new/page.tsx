import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getMyTenant } from "@/app/actions/tenants"
import { NewTournamentForm } from "@/components/tournaments/new-tournament-form"

export default async function NewTournamentPage() {
  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  return <NewTournamentForm tenantId={tenant.id} />
}
