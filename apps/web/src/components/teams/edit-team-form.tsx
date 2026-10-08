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
import { ArrowLeft, Save, Loader2, Palette } from "lucide-react"
import { updateTeam } from "@/app/actions/teams"
import type { Team } from "@mtk/database"

interface EditTeamFormProps {
  team: Team
}

export function EditTeamForm({ team }: EditTeamFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: team.name ?? "",
    shortName: team.shortName ?? "",
    city: team.city ?? "",
    homeGround: team.homeGround ?? "",
    primaryColor: team.primaryColor ?? "#2D8B4E",
    secondaryColor: team.secondaryColor ?? "#1A4F8B",
    foundedYear: team.foundedYear?.toString() ?? "",
    maxSquadSize: team.maxSquadSize?.toString() ?? "15",
    description: team.description ?? "",
  })

  const updateField = (key: string, value: string) => setFormData(prev => ({ ...prev, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        await updateTeam(team.id, {
          name: formData.name.trim(),
          shortName: formData.shortName.trim() || null,
          city: formData.city.trim() || null,
          homeGround: formData.homeGround.trim() || null,
          primaryColor: formData.primaryColor || null,
          secondaryColor: formData.secondaryColor || null,
          foundedYear: formData.foundedYear ? Number(formData.foundedYear) : null,
          maxSquadSize: formData.maxSquadSize ? Number(formData.maxSquadSize) : 15,
          description: formData.description.trim() || null,
        })
        toast.success("Team updated successfully!")
        router.push(`/dashboard/teams/${team.id}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update team"
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/teams/${team.id}`}><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Team</h1>
            <p className="text-muted-foreground mt-1">Update team details for {team.name}.</p>
          </div>
        </div>
      </MotionWrapper>

      <form onSubmit={handleSubmit} className="space-y-6">
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card>
            <CardHeader><CardTitle className="text-lg">Team Identity</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name">Team Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Lahore Lions" required className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="shortName">Short Name</Label>
                <Input id="shortName" value={formData.shortName} onChange={(e) => updateField("shortName", e.target.value.toUpperCase())} placeholder="LL" maxLength={5} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={formData.city} onChange={(e) => updateField("city", e.target.value)} placeholder="Lahore" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="homeGround">Home Ground</Label>
                <Input id="homeGround" value={formData.homeGround} onChange={(e) => updateField("homeGround", e.target.value)} placeholder="Gaddafi Stadium" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="foundedYear">Founded Year</Label>
                <Input id="foundedYear" type="number" value={formData.foundedYear} onChange={(e) => updateField("foundedYear", e.target.value)} placeholder="2024" className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea id="desc" value={formData.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Brief description..." rows={3} className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        <MotionWrapper variant="fadeInUp" delay={0.2}>
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Palette className="h-4 w-4" />Team Colors</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="primary">Primary Color</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input type="color" id="primary" value={formData.primaryColor} onChange={(e) => updateField("primaryColor", e.target.value)} className="h-10 w-14 rounded cursor-pointer border" />
                  <Input value={formData.primaryColor} onChange={(e) => updateField("primaryColor", e.target.value)} className="font-mono" />
                </div>
              </div>
              <div>
                <Label htmlFor="secondary">Secondary Color</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input type="color" id="secondary" value={formData.secondaryColor} onChange={(e) => updateField("secondaryColor", e.target.value)} className="h-10 w-14 rounded cursor-pointer border" />
                  <Input value={formData.secondaryColor} onChange={(e) => updateField("secondaryColor", e.target.value)} className="font-mono" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label>Preview</Label>
                <div className="mt-2 h-16 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg" style={{ background: `linear-gradient(135deg, ${formData.primaryColor}, ${formData.secondaryColor})` }}>
                  {formData.shortName || formData.name?.slice(0, 2).toUpperCase() || "??"}
                </div>
              </div>
              <div>
                <Label htmlFor="squad">Max Squad Size</Label>
                <Input id="squad" type="number" value={formData.maxSquadSize} onChange={(e) => updateField("maxSquadSize", e.target.value)} min={5} max={30} className="mt-1.5" />
              </div>
            </CardContent>
          </Card>
        </MotionWrapper>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <MotionWrapper variant="fadeInUp" delay={0.3}>
          <div className="flex items-center justify-end gap-3">
            <Link href={`/dashboard/teams/${team.id}`}><Button variant="outline" type="button">Cancel</Button></Link>
            <Button type="submit" variant="gradient-shine" disabled={isPending || !formData.name.trim()}>
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save Changes</>}
            </Button>
          </div>
        </MotionWrapper>
      </form>
    </div>
  )
}
