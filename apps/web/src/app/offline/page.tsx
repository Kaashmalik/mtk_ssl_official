import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { WifiOff } from "lucide-react"

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WifiOff className="h-5 w-5" /> You&apos;re offline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This page isn&apos;t cached yet. Reconnect to load it.
          </p>
          <p className="text-sm text-muted-foreground">
            Scoring keeps working offline — balls you record are queued and synced
            automatically when the connection returns.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <a href="/dashboard">Go to dashboard</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/dashboard/scoring">Scoring console</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}