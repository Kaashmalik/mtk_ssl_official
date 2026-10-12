"use client"

import { UseFormReturn } from "react-hook-form"
import { Card, CardContent, Input, Label } from "@mtk/ui"
import { Image as ImageIcon } from "lucide-react"
import { TournamentFormData } from "../tournament-wizard"
import { useLanguage } from "@/hooks/use-language"
import { useEffect, useRef } from "react"
import { tournamentLogoFileError } from "@/lib/tournament-logo"
import { logoSchema } from "@mtk/database/lib/tournament-configuration"

interface StepBrandingProps {
  form: UseFormReturn<TournamentFormData>
  onUploadPendingChange: (pending: boolean) => void
}

export function StepBranding({ form, onUploadPendingChange }: StepBrandingProps) {
  const { t } = useLanguage()
  const logoPreview = form.watch("logo")
  const uploadVersion = useRef(0)
  useEffect(() => () => {
    uploadVersion.current++
    onUploadPendingChange(false)
  }, [onUploadPendingChange])

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const version = ++uploadVersion.current
    if (file) {
      const error = tournamentLogoFileError(file)
      if (error) {
        onUploadPendingChange(false)
        form.setError("logo", { message: error })
        e.target.value = ""
        return
      }
      const reader = new FileReader()
      onUploadPendingChange(true)
      reader.onloadend = () => {
        if (version !== uploadVersion.current) return
        onUploadPendingChange(false)
        const result = logoSchema.safeParse(reader.result)
        if (!result.success) {
          form.setError("logo", { message: "Could not read this image. Try another file." })
          return
        }
        form.setValue("logo", result.data, { shouldValidate: true, shouldDirty: true })
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t("branding")}
        </h2>
        <p className="text-gray-600 dark:text-gray-300">
          {t("brandingDescription") || "Customize your tournament appearance"}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="logo">{t("uploadLogo")}</Label>
                <div className="mt-2">
                  <input
                    id="logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <label htmlFor="logo">
                    <div className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors">
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="max-h-32 mx-auto"
                        />
                      ) : (
                        <div className="space-y-2">
                          <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            Click to upload logo
                          </p>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-2">PNG, JPEG or WebP. Maximum 128 KB.</p>
                {form.formState.errors.logo && <p role="alert" className="text-sm text-destructive">{form.formState.errors.logo.message}</p>}
              </div>

              <div>
                <Label htmlFor="primaryColor">{t("primaryColor")}</Label>
                <div className="mt-2 flex items-center gap-4">
                  <Input
                    id="primaryColor"
                    type="color"
                    {...form.register("primaryColor")}
                    className="w-20 h-10"
                  />
                  <Input
                    type="text"
                    value={form.watch("primaryColor") || "#10b981"}
                    onChange={(e) => form.setValue("primaryColor", e.target.value, { shouldValidate: true, shouldDirty: true })}
                    placeholder="#10b981"
                    className="flex-1"
                  />
                </div>
                {form.formState.errors.primaryColor && <p role="alert" className="text-sm text-destructive mt-1">{form.formState.errors.primaryColor.message}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">Preview</h3>
            <div
              className="rounded-lg p-6 text-white"
              style={{
                backgroundColor: form.watch("primaryColor") || "#10b981",
              }}
            >
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Logo"
                  className="h-16 mb-4"
                />
              )}
              <h4 className="text-2xl font-bold">
                {form.watch("name") || "Tournament Name"}
              </h4>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

