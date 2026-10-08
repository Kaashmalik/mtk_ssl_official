import { redirect } from "next/navigation"

/**
 * Legacy demo scorer — redirect to the real scoring SoT UI.
 * Keeps old /dashboard/matches/live/[id] bookmarks working.
 */
export default async function LiveMatchRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/matches/${id}/scoring`)
}
