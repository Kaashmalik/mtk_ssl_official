import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, MapPin } from "lucide-react"
import { requireVenueReadContext, readVenueList } from "@/lib/venue-reads"
import { hasPermission } from "@/lib/rbac"
import { VenueRowActions } from "@/components/venues/venue-row-actions"
import { unstable_noStore as noStore } from "next/cache"

const GROUND_LABELS: Record<string, string> = {
  grass: "Grass",
  synthetic: "Synthetic",
  concrete: "Concrete",
  matting: "Matting",
}

export default async function VenuesPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Exact active league + venue:read. Read failures propagate instead of rendering
  // a fake empty list.
  const context = await requireVenueReadContext("venue:read")
  const { venues, truncated } = await readVenueList(context.tenantId)
  const canManage = hasPermission(context.role, "venue:manage")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Venues</h1>
          <p className="text-muted-foreground mt-1">Grounds and facilities for your league.</p>
        </MotionWrapper>
        {canManage && (
          <MotionWrapper variant="fadeInRight">
            <Link href="/dashboard/venues/new">
              <Button variant="gradient-shine" size="lg"><Plus className="mr-2 h-4 w-4" />Add Venue</Button>
            </Link>
          </MotionWrapper>
        )}
      </div>

      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{venues.length}</p>
            <p className="text-xs text-muted-foreground">Total Venues</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{venues.filter((v) => v.isActive).length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-info">
              {venues.reduce((sum, v) => sum + (v.capacity ?? 0), 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Seats listed</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{new Set(venues.map((v) => v.city).filter(Boolean)).size}</p>
            <p className="text-xs text-muted-foreground">Cities</p>
          </div>
        </div>
      </MotionWrapper>

      {venues.length === 0 ? (
        <MotionWrapper variant="fadeInUp">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted/50 p-5 mb-4">
              <MapPin className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="text-lg font-semibold text-muted-foreground">No venues yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">Add the grounds your league plays at, then link them to fixtures.</p>
            {canManage && <Link href="/dashboard/venues/new">
              <Button variant="gradient-shine" size="lg" className="mt-6"><Plus className="mr-2 h-4 w-4" />Add First Venue</Button>
            </Link>}
          </div>
        </MotionWrapper>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {venues.map((venue, i) => {
            const location = [venue.city, venue.state, venue.country].filter(Boolean).join(", ")
            return (
              <MotionWrapper key={venue.id} variant="fadeInUp" delay={0.1 * i}>
                <Card className="overflow-hidden">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base truncate">{venue.name}</h3>
                        {location && <p className="text-xs text-muted-foreground mt-0.5 truncate">{location}</p>}
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ml-3 ${venue.isActive ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}`}>
                        {venue.isActive ? "Active" : "Archived"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {venue.groundType && <span>{GROUND_LABELS[venue.groundType] ?? venue.groundType}</span>}
                      {venue.capacity != null && <span>{venue.capacity.toLocaleString()} seats</span>}
                    </div>
                    {canManage && (
                      <div className="flex items-center justify-end gap-2 mt-4">
                        <Link href={`/dashboard/venues/${venue.id}/edit`}>
                          <Button variant="outline" size="sm">Edit</Button>
                        </Link>
                        <VenueRowActions id={venue.id} isActive={venue.isActive} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </MotionWrapper>
            )
          })}
        </div>
      )}

      {truncated && (
        <p className="text-sm text-muted-foreground text-center">
          Showing the first {venues.length} venues. Archive older venues to see the rest.
        </p>
      )}
    </div>
  )
}
