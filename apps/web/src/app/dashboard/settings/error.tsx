"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { AlertTriangle, RotateCcw, Settings } from "lucide-react"

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[Settings Error]", error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="max-w-md w-full glass-panel-subtle border-destructive/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto p-3 rounded-2xl bg-destructive/10 w-fit mb-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-lg font-bold">Settings Error</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            {error.message || "An error occurred while loading settings configuration."}
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button onClick={reset} variant="default" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Try Again
            </Button>
            <Link href="/dashboard/settings">
              <Button variant="outline" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
