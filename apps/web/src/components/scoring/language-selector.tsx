"use client"

import { useCommentaryStore, type CommentaryLanguage } from "@/stores/commentary-store"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"

const LANGUAGES: { value: CommentaryLanguage; label: string }[] = [
  { value: "english", label: "English" },
  { value: "urdu", label: "اردو" },
  { value: "punjabi", label: "ਪੰਜਾਬੀ" },
  { value: "pashto", label: "پښتو" },
  { value: "sindhi", label: "سنڌي" },
]

export function LanguageSelector() {
  const language = useCommentaryStore((s) => s.language)
  const setLanguage = useCommentaryStore((s) => s.setLanguage)
  return (
    <Select value={language} onValueChange={(v) => setLanguage(v as CommentaryLanguage)}>
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
