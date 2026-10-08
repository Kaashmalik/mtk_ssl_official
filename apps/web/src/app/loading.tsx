import { Loader2 } from "lucide-react"

export default function RootLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Loading Shakir Super League...</p>
      </div>
    </div>
  )
}
