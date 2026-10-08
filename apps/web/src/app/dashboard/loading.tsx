import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Skeleton } from "@mtk/ui/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-4 w-64 mt-2 rounded-lg" />
        </div>
        <Skeleton className="h-11 w-40 rounded-lg" />
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border-none bg-card/40 backdrop-blur-md">
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-4 rounded" />
              <Skeleton className="h-8 w-16 mb-2 rounded" />
              <Skeleton className="h-3 w-32 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Grid Skeleton */}
      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <Card className="border-none bg-card/40 backdrop-blur-md">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-6 w-32 mb-2 rounded" />
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-border/10 last:border-0">
                  <Skeleton className="h-2 w-2 rounded-full mt-1 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-3 w-20 rounded" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-none bg-card/40 backdrop-blur-md">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-6 w-32 mb-2 rounded" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-28 rounded" />
                      <Skeleton className="h-3 w-20 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-4 rounded" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
