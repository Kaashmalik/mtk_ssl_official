"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Button } from "@mtk/ui/components/ui/button"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { GitCompare } from "lucide-react"

interface RosterPlayer {
  id: string
  name: string
}

export function ComparisonPicker({
  players,
  initialA,
  initialB,
}: {
  players: RosterPlayer[]
  initialA: string
  initialB: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [a, setA] = useState(initialA)
  const [b, setB] = useState(initialB)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setA(params.get("a") ?? initialA)
    setB(params.get("b") ?? initialB)
  }, [params, initialA, initialB])

  const apply = () =>
    startTransition(async () => {
      router.push(`/dashboard/stats/compare?a=${a}&b=${b}`)
    })

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label>Player A</Label>
        <Select value={a} onValueChange={setA}>
          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {players.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label>Player B</Label>
        <Select value={b} onValueChange={setB}>
          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {players.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={apply} disabled={isPending || a === b}>
        <GitCompare className="h-4 w-4 mr-2" />
        {isPending ? "Loading..." : "Compare"}
      </Button>
    </div>
  )
}