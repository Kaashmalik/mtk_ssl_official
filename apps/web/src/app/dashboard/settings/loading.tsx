import { Skeleton } from "@mtk/ui/components/ui/skeleton"

export default function SettingsLoading() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Skeleton className="h-9 w-36 mb-2" />
        <Skeleton className="h-4 w-60" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  )
}
