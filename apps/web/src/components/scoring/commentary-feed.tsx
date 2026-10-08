"use client"

import { useEffect, useRef } from "react"
import { useCommentaryStore } from "@/stores/commentary-store"

export function CommentaryFeed() {
  const entries = useCommentaryStore((s) => s.entries)
  const language = useCommentaryStore((s) => s.language)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [entries.length])

  return (
    <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-2 pr-1">
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          Commentary will appear here as balls are bowled.
        </p>
      )}
      {entries.map((e, i) => (
        <div key={`${e.ballId}-${i}`} className="rounded-md border p-2 text-sm">
          <p>{e[language]}</p>
          <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{e.generatedBy}</p>
        </div>
      ))}
    </div>
  )
}
