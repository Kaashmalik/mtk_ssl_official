"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@mtk/ui/components/ui/dialog"
import { Trash2, Loader2 } from "lucide-react"

/**
 * A reusable delete button with a confirmation dialog.
 *
 * Calls a "use server" action that takes an id and returns
 * `{ success: boolean }`. On success it redirects to `redirectHref` (e.g. the
 * list page) and shows a toast. Deletion is tenant-scoped server-side by the
 * action, so this component never needs to pass a tenant id.
 *
 * Used on team / player / tournament / match detail pages to finally expose
 * the delete* actions that were already implemented but never wired to the UI.
 */
interface DeleteButtonProps {
  /** The server action to invoke, e.g. `deleteTeam`. */
  action: (id: string) => Promise<{ success: boolean }>
  /** Id of the entity to delete. */
  id: string
  /** Where to navigate after a successful delete (usually the list page). */
  redirectHref: string
  /** What kind of thing is being deleted, e.g. "team" — used in copy. */
  entityLabel?: string
  /** Optional confirmation prompt detail, e.g. the entity name. */
  entityName?: string
  /** Optional button variant (defaults to destructive outline). */
  variant?: "outline" | "destructive" | "ghost"
  /** Cancellation preserves the row/history; do not describe it as deletion. */
  operation?: "delete" | "cancel"
}

export function DeleteButton({
  action,
  id,
  redirectHref,
  entityLabel = "item",
  entityName,
  variant = "outline",
  operation = "delete",
}: DeleteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await action(id)
        toast.success(`${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} ${operation === "cancel" ? "cancelled" : "deleted"}`)
        setOpen(false)
        router.push(redirectHref)
        router.refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to ${operation} ${entityLabel}`
        toast.error(message)
        setOpen(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" className={variant === "outline" ? "text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30" : ""}>
          <Trash2 className="h-4 w-4 mr-1" />
          {operation === "cancel" ? "Cancel fixture" : "Delete"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{operation === "cancel" ? "Cancel" : "Delete"} {entityLabel}?</DialogTitle>
          <DialogDescription>
            Are you sure you want to {operation === "cancel" ? "cancel" : "permanently delete"}
            {entityName ? <strong className="text-foreground"> {entityName}</strong> : ` this ${entityLabel}`}?
            {operation === "cancel" ? "Only an unstarted fixture can be cancelled. The record and history are preserved." : "This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {operation === "cancel" ? "Cancelling..." : "Deleting..."}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                {operation === "cancel" ? "Cancel" : "Delete"} {entityLabel}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
