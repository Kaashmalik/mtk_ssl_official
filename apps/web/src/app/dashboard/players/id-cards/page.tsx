import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { getIssuedPlayerIds } from "@/app/actions/player-ids"
import { unstable_noStore as noStore } from "next/cache"

export const metadata = { title: "Player ID Cards" }

export default async function IssuedIdsPage() {
  noStore()
  const { userId } = await auth()
  if (!userId) redirect("/")

  const rows = await getIssuedPlayerIds()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Player ID Cards</h1>
        <p className="text-muted-foreground mt-1">
          League-issued identification cards. Open a card to print or save as PDF.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issued Cards</CardTitle>
          <CardDescription>{rows.length} card{rows.length === 1 ? "" : "s"} issued</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ID cards issued yet. Issue one from a player&apos;s profile page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="py-2 text-left font-medium">Player</th>
                    <th className="py-2 text-left font-medium">ID Number</th>
                    <th className="py-2 text-left font-medium">Team</th>
                    <th className="py-2 text-left font-medium">Issued</th>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Card</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const expired = r.expiryDate ? new Date(r.expiryDate).getTime() < Date.now() : false
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.playerName}</td>
                        <td className="py-2 font-mono text-xs">{r.formattedId}</td>
                        <td className="py-2 text-muted-foreground">{r.teamName ?? "—"}</td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(r.issueDate).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={r.isValid && !expired ? "text-green-600" : "text-destructive"}
                          >
                            {r.isValid ? (expired ? "Expired" : "Valid") : "Revoked"}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/dashboard/players/id-card/${r.id}`}>Open</Link>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}