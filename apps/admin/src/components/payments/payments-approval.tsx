"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Separator } from "@mtk/ui/components/ui/separator"
import {
  Check,
  X,
  Clock,
  Eye,
  Loader2,
  Image as ImageIcon,
  ArrowUpDown,
  AlertCircle,
  RefreshCw,
} from "lucide-react"

type RequestStatus = "pending" | "approved" | "rejected" | "expired" | "all"

interface SubscriptionRequest {
  id: string
  tenantId: string
  userId: string
  requestedPlan: string
  currentPlan: string
  amount: string
  paymentMethod: string
  paymentProofUrl: string
  transactionReference: string
  status: string
  adminNotes: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  expiresAt: string
  createdAt: string
  // Joined fields
  tenantName: string | null
  tenantSlug: string | null
  userEmail: string | null
  userDisplayName: string | null
}

const STATUS_TABS: { key: RequestStatus; label: string; icon: typeof Clock }[] = [
  { key: "pending", label: "Pending", icon: Clock },
  { key: "approved", label: "Approved", icon: Check },
  { key: "rejected", label: "Rejected", icon: X },
  { key: "expired", label: "Expired", icon: AlertCircle },
]

export function PaymentsApproval() {
  const [requests, setRequests] = useState<SubscriptionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<RequestStatus>("pending")
  const [selectedRequest, setSelectedRequest] = useState<SubscriptionRequest | null>(null)
  const [adminNotes, setAdminNotes] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)

  const fetchRequests = useCallback(async (status?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status && status !== "all") params.set("status", status)
      const res = await fetch(`/api/subscriptions?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setRequests(data.requests || [])
      }
    } catch (err) {
      console.error("Failed to fetch requests:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRequests(activeTab)
  }, [activeTab, fetchRequests])

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActionLoading(id)
    try {
      const res = await fetch("/api/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, adminNotes: adminNotes.trim() || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Action failed")
      }

      // Remove from list and close detail view
      setRequests((prev) => prev.filter((r) => r.id !== id))
      setSelectedRequest(null)
      setAdminNotes("")
      fetchRequests(activeTab)
    } catch (err) {
      console.error(`Failed to ${action} request:`, err)
      alert(err instanceof Error ? err.message : "Action failed")
    } finally {
      setActionLoading(null)
    }
  }

  const openPreview = (url: string) => {
    setImagePreview(url)
    setImageError(false)
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700 border-yellow-300",
      approved: "bg-green-100 text-green-700 border-green-300",
      rejected: "bg-red-100 text-red-700 border-red-300",
      expired: "bg-gray-100 text-gray-600 border-gray-300",
    }
    return (
      <Badge variant="outline" className={`capitalize ${styles[status] || ""}`}>
        {status}
      </Badge>
    )
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-2 border-b pb-3">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
            className="gap-1.5"
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
            {activeTab === tab.key && requests.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {requests.length}
              </Badge>
            )}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchRequests(activeTab)}
          className="ml-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      {loading && requests.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">No {activeTab} requests</p>
            <p className="text-sm mt-1">
              {activeTab === "pending"
                ? "All caught up! No requests waiting for review."
                : `No ${activeTab} requests found.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Request List */}
          <div className="lg:col-span-1 space-y-3">
            {requests.map((req) => (
              <Card
                key={req.id}
                className={`cursor-pointer transition-colors hover:border-primary/40 ${
                  selectedRequest?.id === req.id ? "border-primary ring-1 ring-primary/20" : ""
                }`}
                onClick={() => {
                  setSelectedRequest(req)
                  setAdminNotes("")
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {req.tenantName || "Unknown Tenant"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {req.userEmail || "Unknown email"}
                      </div>
                    </div>
                    {statusBadge(req.status)}
                  </div>
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground capitalize">
                      {req.currentPlan} → {req.requestedPlan}
                    </span>
                    <span className="font-medium">Rs {Number(req.amount).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(req.createdAt).toLocaleDateString()} at{" "}
                    {new Date(req.createdAt).toLocaleTimeString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-2">
            {selectedRequest ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span>{selectedRequest.tenantName || "Unknown Tenant"}</span>
                    {statusBadge(selectedRequest.status)}
                  </CardTitle>
                  <CardDescription>
                    {selectedRequest.userEmail || "Unknown"} &middot;{" "}
                    {selectedRequest.tenantSlug
                      ? `${selectedRequest.tenantSlug}.ssl.cricket`
                      : "No slug"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Plan Change */}
                  <div className="rounded-lg border p-4">
                    <div className="text-sm font-medium mb-2">Plan Change</div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="capitalize text-sm">
                        {selectedRequest.currentPlan}
                      </Badge>
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      <Badge className="text-sm capitalize">{selectedRequest.requestedPlan}</Badge>
                      <span className="ml-auto font-bold">
                        Rs {Number(selectedRequest.amount).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Payment Details */}
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="text-sm font-medium">Payment Details</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Method:</span>{" "}
                        <span className="capitalize">{selectedRequest.paymentMethod.replace("_", " ")}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ref:</span>{" "}
                        <span className="font-mono text-xs">{selectedRequest.transactionReference}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Submitted:</span>{" "}
                        {new Date(selectedRequest.createdAt).toLocaleString()}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Expires:</span>{" "}
                        {new Date(selectedRequest.expiresAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Receipt Preview */}
                  <div className="rounded-lg border p-4">
                    <div className="text-sm font-medium mb-2">Payment Receipt</div>
                    <button
                      onClick={() => openPreview(selectedRequest.paymentProofUrl)}
                      className="block w-full rounded-lg border overflow-hidden hover:ring-2 ring-primary/20 transition-all"
                    >
                      <img
                        src={selectedRequest.paymentProofUrl}
                        alt="Payment receipt"
                        className="w-full h-64 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = ""
                          ;(e.target as HTMLImageElement).alt = "Failed to load image"
                        }}
                      />
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full gap-1.5"
                      onClick={() => window.open(selectedRequest.paymentProofUrl, "_blank")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Open Full Size
                    </Button>
                  </div>

                  {/* Previous Admin Notes */}
                  {selectedRequest.adminNotes && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                      <div className="text-sm font-medium text-yellow-800">Previous Notes</div>
                      <p className="text-sm text-yellow-700 mt-1">{selectedRequest.adminNotes}</p>
                    </div>
                  )}

                  {/* Admin Actions (only for pending) */}
                  {selectedRequest.status === "pending" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Admin Notes (optional)</label>
                        <Textarea
                          placeholder="Add notes for the tenant..."
                          value={adminNotes}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdminNotes(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <div className="flex gap-3 pt-2">
                        <Button
                          className="flex-1 gap-1.5"
                          variant="destructive"
                          onClick={() => handleAction(selectedRequest.id, "reject")}
                          disabled={actionLoading === selectedRequest.id}
                        >
                          {actionLoading === selectedRequest.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                          Reject
                        </Button>
                        <Button
                          className="flex-1 gap-1.5"
                          onClick={() => handleAction(selectedRequest.id, "approve")}
                          disabled={actionLoading === selectedRequest.id}
                        >
                          {actionLoading === selectedRequest.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Approve
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Eye className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-lg font-medium">Select a Request</p>
                  <p className="text-sm mt-1">
                    Click a request from the list to view details and take action.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Full-size Image Modal */}
      {imagePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setImagePreview(null)}
        >
          <div className="relative max-w-4xl w-full">
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <X className="h-6 w-6" />
            </button>
            {!imageError ? (
              <img
                src={imagePreview}
                alt="Receipt full size"
                className="w-full max-h-[80vh] object-contain rounded-lg"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="bg-white rounded-lg p-8 text-center">
                <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Failed to load image</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => window.open(imagePreview, "_blank")}
                >
                  Open in New Tab
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
