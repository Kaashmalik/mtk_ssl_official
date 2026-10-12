import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import type { Tournament } from "@mtk/database"
import { readPrizePool, readTournamentConfiguration } from "@mtk/database/lib/tournament-configuration"

export function TournamentSettingsSummary({ tournament }: { tournament: Tournament }) {
  const configuration = readTournamentConfiguration(tournament.rules)
  if (!configuration) return null
  return (
    <Card>
      <CardHeader><CardTitle>Tournament setup</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div><dt className="text-muted-foreground">Match type</dt><dd className="font-medium capitalize">{configuration.matchType.replace("_", " ")} · {configuration.overs} overs</dd></div>
          <div><dt className="text-muted-foreground">Location</dt><dd className="font-medium">{configuration.location}</dd></div>
          <div><dt className="text-muted-foreground">Entry fee (amount)</dt><dd className="font-medium">{tournament.entryFee ?? "0.00"}</dd></div>
          <div><dt className="text-muted-foreground">Prize pool (amount)</dt><dd className="font-medium">{readPrizePool(tournament.prizePool) ?? "Not specified"}</dd></div>
        </dl>
        {tournament.format !== "league" && tournament.format !== "round_robin" && (
          <p className="text-sm"><span className="text-muted-foreground">Bracket slot order: </span>{configuration.seedOrder.join(" → ")}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {configuration.branding.logo && <img src={configuration.branding.logo} alt={`${tournament.name} logo`} className="h-14 w-14 rounded object-contain" />}
          {configuration.branding.primaryColor && (
            <span className="inline-flex items-center gap-2"><span className="h-5 w-5 rounded border" style={{ backgroundColor: configuration.branding.primaryColor }} aria-hidden="true" />{configuration.branding.primaryColor}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Saved setup preferences, not generated fixtures. Currency and payment collection are not configured here.</p>
      </CardContent>
    </Card>
  )
}
