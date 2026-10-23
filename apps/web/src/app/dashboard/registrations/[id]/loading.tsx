import React from "react"
import { Skeleton } from "@mtk/ui/components/ui/skeleton"

/** Batch 114: loading affordance for the detail route — matches the detail
 * page's shape (back affordance, title block, entry-status card) so the
 * skeleton hands off to real content without layout shift. */
export default function RegistrationDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="space-y-3 rounded-lg border p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}
