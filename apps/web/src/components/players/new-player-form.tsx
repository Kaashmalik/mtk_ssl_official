"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Input } from "@mtk/ui/components/ui/input"
import { Label } from "@mtk/ui/components/ui/label"
import { Textarea } from "@mtk/ui/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import { createPlayer } from "@/app/actions/players"
import { resolveActionError } from "@/lib/plan-limit-error"
import { PlanLimitNotice } from "@/components/billing/plan-limit-notice"
import type { PlanLimitDetail } from "@mtk/database"

interface TeamOption {
  id: string
  name: string
}

export function NewPlayerForm({ teams = [] }: { teams?: TeamOption[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [planLimit, setPlanLimit] = useState<PlanLimitDetail | null>(null)
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", dateOfBirth: "",
    nationality: "", city: "",
    role: "", battingStyle: "", bowlingStyle: "",
    jerseyNumber: "", heightCm: "", weightKg: "",
    biography: "",
    teamId: "",
    status: "active",
  })

  const updateField = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPlanLimit(null)

    startTransition(async () => {
      try {
        await createPlayer({
          name: formData.name.trim(),
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
          dateOfBirth: formData.dateOfBirth || null,
          nationality: formData.nationality.trim() || null,
          city: formData.city.trim() || null,
          role: (formData.role || null) as
            | "batsman" | "bowler" | "all_rounder" | "wicket_keeper" | "wicket_keeper_batsman"
            | null,
          battingStyle: (formData.battingStyle || null) as "right" | "left" | null,
          bowlingStyle: (formData.bowlingStyle || null) as
            | "right_arm_fast" | "right_arm_medium" | "right_arm_spin"
            | "left_arm_fast" | "left_arm_medium" | "left_arm_spin" | null,
          jerseyNumber: formData.jerseyNumber ? Number(formData.jerseyNumber) : null,
          heightCm: formData.heightCm ? Number(formData.heightCm) : null,
          weightKg: formData.weightKg ? Number(formData.weightKg) : null,
          biography: formData.biography.trim() || null,
          teamId: formData.teamId || null,
          status: (formData.status || "active") as
            | "active" | "injured" | "retired" | "suspended" | "inactive",
        })
        toast.success("Player registered successfully!")
        router.push("/dashboard/players")
      } catch (err) {
        const resolved = resolveActionError(err, "Failed to register player")
        // Player quota is a billing event: show the upgrade path, not a red error.
        setError(resolved.message)
        setPlanLimit(resolved.planLimit)
        if (!resolved.planLimit) toast.error(resolved.message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/players">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Register Player</h1>
            <p className="text-muted-foreground mt-1">Add a new player to your league database.</p>
          </div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Information */}
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Personal Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Ahmed Khan" required className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={formData.email} onChange={(e) => updateField("email", e.target.value)} placeholder="player@example.com" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={formData.phone} onChange={(e) => updateField("phone", e.target.value)} placeholder="+92 300 1234567" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="dob">Date of Birth</Label>
                <Input id="dob" type="date" value={formData.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="nationality">Nationality</Label>
                <Input id="nationality" value={formData.nationality} onChange={(e) => updateField("nationality", e.target.value)} placeholder="Pakistani" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={formData.city} onChange={(e) => updateField("city", e.target.value)} placeholder="Lahore" className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {/* Cricket Details */}
        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Cricket Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Team</Label>
                <Select value={formData.teamId || "none"} onValueChange={(v) => updateField("teamId", v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => updateField("status", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="injured">Injured</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Playing Role</Label>
                <Select value={formData.role} onValueChange={(v) => updateField("role", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="batsman">Batsman</SelectItem>
                    <SelectItem value="bowler">Bowler</SelectItem>
                    <SelectItem value="all_rounder">All-Rounder</SelectItem>
                    <SelectItem value="wicket_keeper">Wicket Keeper</SelectItem>
                    <SelectItem value="wicket_keeper_batsman">WK-Batsman</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Batting Style</Label>
                <Select value={formData.battingStyle} onValueChange={(v) => updateField("battingStyle", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select style" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="right">Right-Hand Bat</SelectItem>
                    <SelectItem value="left">Left-Hand Bat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bowling Style</Label>
                <Select value={formData.bowlingStyle} onValueChange={(v) => updateField("bowlingStyle", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select style" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="right_arm_fast">Right-Arm Fast</SelectItem>
                    <SelectItem value="right_arm_medium">Right-Arm Medium</SelectItem>
                    <SelectItem value="right_arm_spin">Right-Arm Spin</SelectItem>
                    <SelectItem value="left_arm_fast">Left-Arm Fast</SelectItem>
                    <SelectItem value="left_arm_medium">Left-Arm Medium</SelectItem>
                    <SelectItem value="left_arm_spin">Left-Arm Spin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="jersey">Jersey Number</Label>
                <Input id="jersey" type="number" value={formData.jerseyNumber} onChange={(e) => updateField("jerseyNumber", e.target.value)} placeholder="7" min={0} max={999} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="height">Height (cm)</Label>
                <Input id="height" type="number" value={formData.heightCm} onChange={(e) => updateField("heightCm", e.target.value)} placeholder="175" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="weight">Weight (kg)</Label>
                <Input id="weight" type="number" value={formData.weightKg} onChange={(e) => updateField("weightKg", e.target.value)} placeholder="72" className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bio">Biography</Label>
                <Textarea id="bio" value={formData.biography} onChange={(e) => updateField("biography", e.target.value)} placeholder="Brief bio about the player..." rows={3} className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {planLimit ? (
          <PlanLimitNotice detail={planLimit} />
        ) : (
          error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )
        )}

        {/* Actions */}
        <MotionWrapper variant="fadeInUp" delay={0.3}>
          <div className="flex items-center justify-end gap-3">
            <Link href="/dashboard/players"><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.name.trim()}>
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Register Player</>}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
