import { Skeleton } from "@mtk/ui/components/ui/skeleton"

export default function UsersLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-28 mb-2" />
        <Skeleton className="h-4 w-60" />
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
