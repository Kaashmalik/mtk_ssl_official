"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import { createVenue, updateVenue } from "@/app/actions/venues"

export type VenueFormValues = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  capacity: number | null
  groundType: "grass" | "synthetic" | "concrete" | "matting" | null
}

const GROUND_TYPES = ["grass", "synthetic", "concrete", "matting"] as const

export function VenueForm({ venue }: { venue?: VenueFormValues }) {
  const router = useRouter()
  const isEdit = Boolean(venue)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: venue?.name ?? "",
    address: venue?.address ?? "",
    city: venue?.city ?? "",
    state: venue?.state ?? "",
    country: venue?.country ?? "",
    capacity: venue?.capacity != null ? String(venue.capacity) : "",
    groundType: venue?.groundType ?? "",
  })

  const updateField = (key: keyof typeof formData, value: string) =>
    setFormData((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload = {
      name: formData.name.trim(),
      address: formData.address.trim() || null,
      city: formData.city.trim() || null,
      state: formData.state.trim() || null,
      country: formData.country.trim() || null,
      capacity: formData.capacity ? Number(formData.capacity) : null,
      groundType: (formData.groundType || null) as VenueFormValues["groundType"],
    }

    startTransition(async () => {
      try {
        if (isEdit && venue) await updateVenue(venue.id, payload)
        else await createVenue(payload)
        toast.success(isEdit ? "Venue updated" : "Venue created")
        router.push("/dashboard/venues")
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save venue"
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/venues"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{isEdit ? "Edit Venue" : "Add Venue"}</h1>
            <p className="text-muted-foreground mt-1">Grounds and facilities for your league.</p>
          </div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Venue Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name">Venue Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Gaddafi Stadium" required className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={formData.city} onChange={(e) => updateField("city", e.target.value)} placeholder="Lahore" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="state">State / Province</Label>
                <Input id="state" value={formData.state} onChange={(e) => updateField("state", e.target.value)} placeholder="Punjab" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Input id="country" value={formData.country} onChange={(e) => updateField("country", e.target.value)} placeholder="Pakistan" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="capacity">Capacity</Label>
                <Input id="capacity" type="number" min={0} value={formData.capacity} onChange={(e) => updateField("capacity", e.target.value)} placeholder="15000" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="groundType">Ground Type</Label>
                <select
                  id="groundType"
                  value={formData.groundType}
                  onChange={(e) => updateField("groundType", e.target.value)}
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Unspecified</option>
                  {GROUND_TYPES.map((type) => (
                    <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Textarea id="address" value={formData.address} onChange={(e) => updateField("address", e.target.value)} placeholder="Street address..." rows={2} className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <div className="flex items-center justify-end gap-3">
            <Link href="/dashboard/venues"><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.name.trim()}>
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />{isEdit ? "Save Changes" : "Create Venue"}</>}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
