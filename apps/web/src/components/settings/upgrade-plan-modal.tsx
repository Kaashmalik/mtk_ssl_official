"use client"

import { useState, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mtk/ui/components/ui/dialog"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Separator } from "@mtk/ui/components/ui/separator"
import {
  Upload, X, Loader2, CheckCircle2, AlertCircle,
  Building2, Phone, Copy, CheckCheck, ChevronDown, ChevronUp,
} from "lucide-react"
import type { Tenant, PlanKey } from "@mtk/database"
import { PLAN_PRICES } from "@mtk/database/lib/plan-limits"
import { PAYMENT_CONFIG } from "@/lib/payment-config"

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  starter: `Starter — Rs ${PLAN_PRICES.starter.toLocaleString()}`,
  pro: `Pro — Rs ${PLAN_PRICES.pro.toLocaleString()}`,
  enterprise: `Enterprise — Rs ${PLAN_PRICES.enterprise.toLocaleString()}`,
}

interface UpgradePlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedPlan: string | null
  tenant: Tenant
  onRequestCreated: () => void
}

export function UpgradePlanModal({
  open,
  onOpenChange,
  selectedPlan,
  tenant,
  onRequestCreated,
}: UpgradePlanModalProps) {
  const [step, setStep] = useState<"upload" | "submitting" | "success" | "error">("upload")
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer")
  const [transactionReference, setTransactionReference] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [showPaymentDetails, setShowPaymentDetails] = useState(true)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const amount = selectedPlan ? (PLAN_PRICES[selectedPlan as PlanKey] || 0) : 0

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setStep("upload")
      setPaymentMethod("bank_transfer")
      setTransactionReference("")
      setProofFile(null)
      setProofPreviewUrl(null)

      setError(null)
      setShowPaymentDetails(true)
    }
    onOpenChange(newOpen)
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const CopyBtn = ({ text, field }: { text: string; field: string }) => (
    <button
      type="button"
      onClick={() => copyToClipboard(text, field)}
      className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted transition-colors shrink-0"
    >
      {copiedField === field ? (
        <CheckCheck className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  )

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Invalid file type. Use JPEG, PNG, WebP, or GIF.")
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("File too large. Maximum size is 5 MB.")
      return
    }

    setError(null)
    setProofFile(file)

    const url = URL.createObjectURL(file)
    setProofPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
  }

  const handleRemoveFile = () => {
    setProofFile(null)
    setProofPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSubmit = async () => {
    if (!selectedPlan || !proofFile || !transactionReference.trim()) {
      setError("Please fill in all fields and upload a receipt.")
      return
    }

    setError(null)
    setStep("submitting")

    try {
      const uploadForm = new FormData()
      uploadForm.append("file", proofFile)

      const uploadRes = await fetch("/api/payments/upload-proof", {
        method: "POST",
        body: uploadForm,
      })

      if (!uploadRes.ok) {
        const uploadData = await uploadRes.json()
        throw new Error(uploadData.error || "Failed to upload receipt")
      }

      const uploadData = await uploadRes.json()


      const requestRes = await fetch("/api/subscriptions/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedPlan: selectedPlan,
          paymentMethod,
          paymentProofUrl: uploadData.url,
          transactionReference: transactionReference.trim(),
        }),
      })

      if (!requestRes.ok) {
        const requestData = await requestRes.json()
        throw new Error(requestData.error || "Failed to create subscription request")
      }

      setStep("success")
      onRequestCreated()
    } catch (err) {
      console.error("Upgrade submission error:", err)
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStep("error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "success"
              ? "Request Submitted! ✅"
              : `Upgrade to ${selectedPlan ? selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1) : ""}`}
          </DialogTitle>
          <DialogDescription>
            {step === "success"
              ? "Your payment is being reviewed by our team."
              : step === "submitting"
                ? "Processing your request..."
                : `Upgrade from ${tenant.plan} → ${selectedPlan} — Rs ${amount?.toLocaleString()}`}
          </DialogDescription>
        </DialogHeader>

        {step === "success" ? (
          <div className="py-6 text-center space-y-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 mx-auto">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            </div>
            <div>
              <p className="font-semibold text-lg">Payment Proof Received!</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                Your upgrade request has been submitted and is pending admin review.
                You&apos;ll see the status update on your billing page within 24–48 hours.
              </p>
            </div>
            <Button onClick={() => handleOpenChange(false)} size="lg" className="min-w-[120px]">
              Done
            </Button>
          </div>
        ) : step === "submitting" ? (
          <div className="py-12 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="mt-4 text-sm text-muted-foreground font-medium">
              Uploading receipt &amp; creating your request...
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Plan Summary */}
            <div className="rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Upgrading to</div>
                  <div className="font-semibold mt-0.5">
                    {selectedPlan && PLAN_DISPLAY_NAMES[selectedPlan]}
                  </div>
                </div>
                <Badge className="text-sm h-8 px-3 font-bold">
                  Rs {amount?.toLocaleString()}
                </Badge>
              </div>
            </div>

            {/* Payment Details — contextual based on method */}
            <div className="rounded-xl border overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                onClick={() => setShowPaymentDetails(!showPaymentDetails)}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${
                    paymentMethod === "bank_transfer"
                      ? "bg-green-100 text-green-700"
                      : "bg-purple-100 text-purple-700"
                  }`}>
                    {paymentMethod === "bank_transfer" ? (
                      <Building2 className="h-4 w-4" />
                    ) : (
                      <Phone className="h-4 w-4" />
                    )}
                  </div>
                  <span className="text-sm font-medium">
                    {paymentMethod === "bank_transfer"
                      ? `${PAYMENT_CONFIG.bankName} — ${PAYMENT_CONFIG.bankTitle}`
                      : paymentMethod === "jazzcash_manual"
                        ? `JazzCash — ${PAYMENT_CONFIG.jazzcashNumber}`
                        : `EasyPaisa — ${PAYMENT_CONFIG.easypaisaNumber}`}
                  </span>
                </div>
                {showPaymentDetails ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {showPaymentDetails && (
                <div className="border-t bg-muted/20 px-4 py-4">
                  {paymentMethod === "bank_transfer" ? (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bank</div>
                        <div className="font-medium flex items-center">{PAYMENT_CONFIG.bankName}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Branch</div>
                        <div className="font-medium">{PAYMENT_CONFIG.bankBranch}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Title</div>
                        <div className="font-mono font-semibold flex items-center">
                          {PAYMENT_CONFIG.bankTitle} <CopyBtn text={PAYMENT_CONFIG.bankTitle} field="m_bank_title" />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account No</div>
                        <div className="font-mono font-semibold flex items-center">
                          {PAYMENT_CONFIG.bankAccount} <CopyBtn text={PAYMENT_CONFIG.bankAccount} field="m_bank_acct" />
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">IBAN</div>
                        <div className="font-mono font-semibold flex items-center">
                          {PAYMENT_CONFIG.bankIban} <CopyBtn text={PAYMENT_CONFIG.bankIban} field="m_bank_iban" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {paymentMethod === "jazzcash_manual" ? "JazzCash" : "EasyPaisa"} Name
                          </div>
                          <div className="font-mono font-semibold flex items-center">
                            {paymentMethod === "jazzcash_manual" ? PAYMENT_CONFIG.jazzcashName : PAYMENT_CONFIG.easypaisaName} <CopyBtn text={paymentMethod === "jazzcash_manual" ? PAYMENT_CONFIG.jazzcashName : PAYMENT_CONFIG.easypaisaName} field={`m_${paymentMethod}_name`} />
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Number</div>
                          <div className="font-mono font-semibold flex items-center">
                            {paymentMethod === "jazzcash_manual" ? PAYMENT_CONFIG.jazzcashNumber : PAYMENT_CONFIG.easypaisaNumber} <CopyBtn text={paymentMethod === "jazzcash_manual" ? PAYMENT_CONFIG.jazzcashNumber : PAYMENT_CONFIG.easypaisaNumber} field={`m_${paymentMethod}_num`} />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg bg-teal-50 border border-teal-200 p-2.5 text-sm text-teal-700">
                        <div className="flex items-center gap-1.5 font-medium">
                          💡 Raast ID: <span className="font-mono">{PAYMENT_CONFIG.raastId}</span>
                          <CopyBtn text={PAYMENT_CONFIG.raastId} field={`m_${paymentMethod}_raast`} />
                        </div>
                        <p className="text-xs text-teal-600 mt-0.5">You can also send via Raast for instant transfer</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Payment Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "bank_transfer", label: "Bank Transfer", icon: Building2 },
                  { value: "jazzcash_manual", label: "JazzCash", icon: Phone },
                  { value: "easypaisa_manual", label: "EasyPaisa", icon: Phone },
                ].map((method) => (
                  <Button
                    key={method.value}
                    type="button"
                    variant={paymentMethod === method.value ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5 h-9"
                    onClick={() => setPaymentMethod(method.value)}
                  >
                    <method.icon className="h-3.5 w-3.5" />
                    {method.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Receipt Upload */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Upload Payment Receipt</Label>
              {proofPreviewUrl ? (
                <div className="relative rounded-xl border overflow-hidden group">
                  <img
                    src={proofPreviewUrl}
                    alt="Receipt preview"
                    className="w-full h-52 object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-2 left-2">
                    <Badge variant="secondary" className="text-xs bg-white/90">
                      {proofFile?.name}
                    </Badge>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="receipt-upload"
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all group"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted group-hover:bg-primary/10 transition-colors mb-3">
                    <Upload className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    Click to upload or drag &amp; drop
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    JPEG, PNG, WebP, GIF — Max 5 MB
                  </span>
                </label>
              )}
              <input
                id="receipt-upload"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {/* Transaction Reference */}
            <div className="space-y-2">
              <Label htmlFor="txn-ref" className="text-sm font-medium">
                Transaction Reference
              </Label>
              <Input
                id="txn-ref"
                placeholder="Enter bank transfer reference / transaction ID"
                value={transactionReference}
                onChange={(e) => setTransactionReference(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                You can find this in your bank app&apos;s transaction history or SMS receipt.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3.5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!proofFile || !transactionReference.trim()}
                className="min-w-[140px]"
              >
                Submit Request
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
