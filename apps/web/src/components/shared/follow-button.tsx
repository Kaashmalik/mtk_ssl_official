"use client"

import { useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Heart, Loader2 } from "lucide-react"
import { followEntity, unfollowEntity } from "@/app/actions/follows"
import { toast } from "sonner"

interface FollowButtonProps {
  tenantId: string
  followableType: "team" | "player" | "tournament"
  followableId: string
  initialIsFollowing: boolean
  initialFollowerCount: number
}

export function FollowButton({
  tenantId,
  followableType,
  followableId,
  initialIsFollowing,
  initialFollowerCount,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialIsFollowing)
  const [count, setCount] = useState(initialFollowerCount)
  const [isPending, startTransition] = useTransition()

  const handleToggleFollow = () => {
    startTransition(async () => {
      try {
        if (following) {
          const res = await unfollowEntity(followableType, followableId)
          if (res.success) {
            setFollowing(false)
            setCount(prev => Math.max(0, prev - 1))
            toast.success(`Unfollowed ${followableType}`)
          }
        } else {
          const res = await followEntity(tenantId, followableType, followableId)
          if (res.success) {
            setFollowing(true)
            setCount(prev => prev + 1)
            toast.success(`Following ${followableType}!`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication required to follow"
        toast.error(message)
      }
    })
  }

  return (
    <Button
      variant={following ? "default" : "outline"}
      size="sm"
      onClick={handleToggleFollow}
      disabled={isPending}
      aria-pressed={following}
      aria-label={`${following ? "Unfollow" : "Follow"} ${followableType}`}
      className={`gap-1.5 transition-all ${
        following
          ? "bg-rose-600 hover:bg-rose-700 text-white border-transparent"
          : "hover:text-rose-600 hover:border-rose-600/30 hover:bg-rose-500/5"
      }`}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart className={`h-4 w-4 ${following ? "fill-current" : ""}`} />
      )}
      <span>{following ? "Following" : "Follow"}</span>
      {count > 0 && (
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-xs">
          {count}
        </span>
      )}
    </Button>
  )
}
