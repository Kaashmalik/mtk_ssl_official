import { Skeleton } from "@mtk/ui/components/ui/skeleton"

export default function TeamsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-28 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
