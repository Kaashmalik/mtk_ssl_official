"use client"

import { useEffect, useRef, useState } from "react"
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
import { getTournament, getTournamentCopyOptions } from "@/app/actions/tournaments"
import { useLanguage } from "@/hooks/use-language"
import { toast } from "sonner"
import { tournamentToWizardDefaults } from "@/lib/tournament-wizard"

type TournamentListItem = Awaited<ReturnType<typeof getTournamentCopyOptions>>[number]

interface CopyFromPreviousProps {
  form: UseFormReturn<TournamentFormData>
  disabled?: boolean
}

export function CopyFromPrevious({ form, disabled = false }: CopyFromPreviousProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const selectionVersion = useRef(0)
  useEffect(() => {
    if (disabled) {
      selectionVersion.current++
      setOpen(false)
      setLoading(false)
    }
  }, [disabled])
  useEffect(() => () => { selectionVersion.current++ }, [])

  const loadTournaments = async () => {
    const version = ++selectionVersion.current
    setLoading(true)
    try {
      const options = await getTournamentCopyOptions()
      if (version === selectionVersion.current) setTournaments(options)
    } catch (err) {
      console.error(err)
      if (version === selectionVersion.current) toast.error("Failed to load previous tournaments")
    } finally {
      if (version === selectionVersion.current) setLoading(false)
    }
  }

  const handleSelect = async (option: TournamentListItem) => {
    if (disabled) return
    const version = ++selectionVersion.current
    setLoading(true)
    try {
      const tournament = await getTournament(option.id)
      if (version !== selectionVersion.current) return
      if (!tournament) throw new Error("Tournament is no longer available")
      form.reset({ ...form.getValues(), ...tournamentToWizardDefaults(tournament) })
      toast.success(`Settings copied from "${tournament.name}"`)
      setOpen(false)
    } catch (error) {
      if (version === selectionVersion.current) toast.error(error instanceof Error ? error.message : "Could not copy tournament settings")
    } finally {
      if (version === selectionVersion.current) setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen)
      if (!newOpen) { selectionVersion.current++; setLoading(false) }
      if (newOpen) {
        loadTournaments()
      }
    }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
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
