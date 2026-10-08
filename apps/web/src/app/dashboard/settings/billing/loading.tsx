import { Skeleton } from "@mtk/ui/components/ui/skeleton"

export default function BillingLoading() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Skeleton className="h-9 w-44 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-[450px] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
