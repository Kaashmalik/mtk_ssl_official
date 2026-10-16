import { Badge } from "@mtk/ui/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react"
import { computeMatchReadiness, type MatchReadinessInput } from "@/lib/match-readiness"

/**
 * Pre-match readiness checklist (COMP-06). Pure presentation over
 * lib/match-readiness — blocking failures mean the fixture is not playable.
 */
export function MatchReadinessCard({ match }: { match: MatchReadinessInput }) {
  const { ready, checks } = computeMatchReadiness(match)
  const failingBlocking = checks.filter(check => check.blocking && !check.pass)

  return (
    <Card className="border-none shadow-lg bg-card/50 backdrop-blur-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          Match Readiness
          <Badge variant={ready ? "default" : failingBlocking.length > 0 ? "destructive" : "secondary"}>
            {ready ? "Ready" : failingBlocking.length > 0 ? "Not playable" : "Almost there"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {checks.map(check => (
          <div key={check.id} className="flex items-center gap-2 text-sm">
            {check.pass ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : check.blocking ? (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className={check.pass ? "" : check.blocking ? "text-destructive" : "text-muted-foreground"}>
              {check.label}
              {!check.blocking && !check.pass && " (recommended)"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
