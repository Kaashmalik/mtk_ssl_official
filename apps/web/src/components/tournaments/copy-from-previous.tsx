"use client"

import { useState } from "react"
import { UseFormReturn } from "react-hook-form"
import { Button } from "@mtk/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@mtk/ui/components/ui/dialog"
import { Copy, Loader2 } from "lucide-react"
import { TournamentFormData } from "./tournament-wizard"
import { getTournaments } from "@/app/actions/tournaments"
import { useLanguage } from "@/hooks/use-language"
import { toast } from "sonner"

interface TournamentListItem {
  id: string
  name: string
  format: "knockout" | "league" | "hybrid"
  maxTeams: number | null
  description: string | null
}

interface CopyFromPreviousProps {
  form: UseFormReturn<TournamentFormData>
}

export function CopyFromPrevious({ form }: CopyFromPreviousProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadTournaments = async () => {
    setLoading(true)
    try {
      const result = await getTournaments({
        page: 1,
        pageSize: 50,
        sortBy: "createdAt",
        sortOrder: "desc"
      })
      // Map formatting to match
      const mapped = (result.data as any[]).map(item => ({
        id: item.id,
        name: item.name,
        format: (item.format === "round_robin" ? "league" : item.format) as "knockout" | "league" | "hybrid",
        maxTeams: item.maxTeams,
        description: item.description,
      }))
      setTournaments(mapped)
    } catch (err) {
      console.error(err)
      toast.error("Failed to load previous tournaments")
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (tournament: TournamentListItem) => {
    form.setValue("format", tournament.format)
    form.setValue("maxTeams", tournament.maxTeams || 8)
    if (tournament.description) {
      form.setValue("description", tournament.description)
    }
    toast.success(`Settings copied from "${tournament.name}"`)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen)
      if (newOpen) {
        loadTournaments()
      }
    }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2"
        >
          <Copy className="w-4 h-4" />
          {t("copyFromPrevious") || "Copy Previous"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy Tournament Settings</DialogTitle>
          <DialogDescription>
            Select a previous tournament to copy its format, settings, and description.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No previous tournaments found.
          </div>
        ) : (
          <div className="space-y-2 mt-4">
            {tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t)}
                className="w-full text-left p-3 rounded-xl border hover:bg-muted/50 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="font-semibold text-sm group-hover:text-primary transition-colors">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 capitalize">
                    {t.format} · Max {t.maxTeams || "unlimited"} Teams
                  </div>
                </div>
                <Copy className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
