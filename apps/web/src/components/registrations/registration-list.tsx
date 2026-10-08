"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mtk/ui/components/ui/table"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mtk/ui/components/ui/dialog"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { approveRegistration, rejectRegistration } from "@/app/actions/registrations"

interface Registration {
  id: string
  teamName: string
  tournamentName: string
  squadCount: number
  registrationFee: string
  notes: string | null
  status: "pending" | "approved" | "rejected" | "withdrawn" | "waitlisted"
  paymentStatus: "unpaid" | "paid" | "refunded" | "waived"
  createdAt: Date
}

interface RegistrationListProps {
  initialRegistrations: Registration[]
}

export function RegistrationList({ initialRegistrations }: RegistrationListProps) {
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegistrations)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")

  const handleApprove = async (id: string) => {
    setUpdatingId(id)
    try {
      const res = await approveRegistration(id)
      if (res.success) {
        setRegistrations(prev => prev.map(r => r.id === id ? { ...r, status: "approved" as const } : r))
        toast.success("Registration approved successfully!")
      } else {
        toast.error("Failed to approve registration")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to approve registration")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRejectSubmit = async () => {
    if (!rejectingId) return
    setUpdatingId(rejectingId)
    const targetId = rejectingId
    setRejectingId(null) // close modal
    
    try {
      const res = await rejectRegistration(targetId, rejectionReason)
      if (res.success) {
        setRegistrations(prev => prev.map(r => r.id === targetId ? { ...r, status: "rejected" as const } : r))
        toast.success("Registration rejected successfully")
        setRejectionReason("")
      } else {
        toast.error("Failed to reject registration")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to reject registration")
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Tournament</TableHead>
              <TableHead>Squad Size</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.map((reg) => {
              const isPending = reg.status === "pending"
              const isUpdating = updatingId === reg.id

              return (
                <TableRow key={reg.id} className="hover:bg-muted/10">
                  <TableCell>
                    <div>
                      <span className="font-semibold text-sm block">{reg.teamName}</span>
                      {reg.notes && (
                        <span className="text-xs text-muted-foreground block max-w-xs truncate italic">
                          &ldquo;{reg.notes}&rdquo;
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{reg.tournamentName}</TableCell>
                  <TableCell className="text-sm tabular-nums">{reg.squadCount} players</TableCell>
                  <TableCell className="text-sm tabular-nums">PKR {Number(reg.registrationFee).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${reg.status === "approved" ? "bg-success/5 text-success border-success/20" : reg.status === "rejected" ? "bg-destructive/5 text-destructive border-destructive/20" : "bg-info/5 text-info border-info/20"}`}>
                      {reg.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                    ) : (
                      isPending && (
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-success hover:text-success hover:bg-success/10"
                            onClick={() => handleApprove(reg.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setRejectingId(reg.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      )
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {registrations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-sm">
                  No registration requests received.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Reject Reason Dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(open) => !open && setRejectingId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
            <DialogDescription>
              Please enter a reason for rejecting this team registration request.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="e.g. Squad size is smaller than the required limit, or unpaid registration fees."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectionReason.trim()}
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
