import { MAX_LOGO_BYTES } from "@mtk/database/lib/tournament-configuration"

export function tournamentLogoFileError(file: { type: string; size: number }): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Choose a PNG, JPEG or WebP image."
  if (file.size === 0 || file.size > MAX_LOGO_BYTES) return "Choose an image between 1 byte and 128 KB."
  return null
}
