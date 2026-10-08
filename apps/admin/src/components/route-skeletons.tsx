import { Skeleton } from "@mtk/ui/components/ui/skeleton"

function Header({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      {withAction ? <Skeleton className="h-10 w-32 rounded-lg" /> : null}
    </div>
  )
}

export function AdminListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <Header />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <Skeleton className="h-9 w-full rounded-lg" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export function AdminFormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-6">
      <Header />
      <div className="rounded-xl border bg-card p-6 space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
        <div className="flex justify-end gap-3 pt-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export function AdminDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Header />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border bg-card p-6 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="rounded-xl border bg-card p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
