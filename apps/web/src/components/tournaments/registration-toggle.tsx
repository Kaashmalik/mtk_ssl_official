"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Loader2 } from "lucide-react"
import { openRegistration, closeRegistration } from "@/app/actions/tournaments"

interface RegistrationToggleProps {
  tournamentId: string
  registrationOpen: boolean
}

export function RegistrationToggle({
  tournamentId,
  registrationOpen,
}: RegistrationToggleProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const toggle = () => {
    startTransition(async () => {
      try {
        if (registrationOpen) {
          await closeRegistration(tournamentId)
          toast.success("Registration closed")
        } else {
          await openRegistration(tournamentId)
          toast.success("Registration opened")
        }
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update registration")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={toggle}>
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : registrationOpen ? (
        "Close Registration"
      ) : (
        "Open Registration"
      )}
    </Button>
  )
}
