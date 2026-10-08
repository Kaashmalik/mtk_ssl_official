"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { createTenant } from "@/app/actions/tenants"
import { ShieldCheck, Sparkles } from "lucide-react"

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function LeagueSetupForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [error, setError] = useState<string | null>(null)

  const derivedSlug = useMemo(() => (name ? toSlug(name) : ""), [name])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const payload = {
          name: name.trim(),
          slug: (slug || derivedSlug).trim(),
        }
        await createTenant(payload)
        router.push("/dashboard")
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create league"
        setError(message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-lg">League details</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Your league starts on the Free plan. You can invite team managers, configure tournaments, and upgrade when you need more capacity.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="league-name">League name</Label>
            <Input
              id="league-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shakir Super League"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="league-slug">League URL</Label>
            <Input
              id="league-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={derivedSlug || "your-league"}
              required
            />
            <p className="text-xs text-muted-foreground">
              Your public league URL will be <Badge variant="outline">{(slug || derivedSlug || "your-league")}.ssl.mtkcodex.site</Badge>
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 mt-0.5" />
            Your league data and access are isolated. White-label options depend on your plan; custom domains require Enterprise and domain verification.
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" variant="gradient-shine" disabled={isPending || !name}>
          {isPending ? "Creating league..." : "Create league"}
        </Button>
      </div>
    </form>
  )
}
