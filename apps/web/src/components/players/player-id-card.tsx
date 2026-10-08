import Image from "next/image"
import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { PrintButton } from "@/components/share/print-button"

interface CardData {
  formattedId: string
  playerName: string
  teamName: string | null
  jerseyNumber: number | null
  photoUrl: string | null
  role: string | null
  city: string | null
  issueDate: Date | string
  expiryDate: Date | string | null
  isValid: boolean
  tenantName: string
  tenantSlug: string
}

export function PlayerIdCard({ data }: { data: CardData }) {
  const expired = data.expiryDate ? new Date(data.expiryDate).getTime() < Date.now() : false
  const valid = data.isValid && !expired

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold">Player ID Card</h1>
        <PrintButton />
      </div>

      <Card className="overflow-hidden">
        {/* Header band */}
        <div className="bg-gradient-to-r from-primary to-primary/70 px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-white font-bold tracking-wide">{data.tenantName}</p>
            <p className="text-white/70 text-xs uppercase tracking-widest">Official Player Card</p>
          </div>
          <Badge className={valid ? "bg-white text-primary" : "bg-destructive text-white"}>
            {valid ? "VALID" : expired ? "EXPIRED" : "REVOKED"}
          </Badge>
        </div>

        <CardContent className="pt-5 space-y-4">
          <div className="flex gap-4">
            <div className="h-24 w-24 shrink-0 rounded-lg overflow-hidden bg-muted border">
              {data.photoUrl ? (
                <Image
                  src={data.photoUrl}
                  alt={data.playerName}
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
                  {data.playerName.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <p className="text-lg font-bold truncate">{data.playerName}</p>
              {data.teamName && <p className="text-sm text-muted-foreground truncate">{data.teamName}</p>}
              {data.role && <p className="text-xs uppercase tracking-wide text-muted-foreground">{data.role.replace(/_/g, " ")}</p>}
              {data.jerseyNumber != null && (
                <p className="text-sm">Jersey <span className="font-semibold">#{data.jerseyNumber}</span></p>
              )}
            </div>
          </div>

          <div className="rounded-lg border-2 border-dashed p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Player ID</p>
            <p className="font-mono text-2xl font-bold tracking-wider">{data.formattedId}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Issued</p>
              <p className="font-medium">{new Date(data.issueDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Expires</p>
              <p className="font-medium">
                {data.expiryDate ? new Date(data.expiryDate).toLocaleDateString() : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground uppercase tracking-wide">Season</p>
              <p className="font-medium">{new Date(data.issueDate).getUTCFullYear()}</p>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            {data.tenantName} · {data.tenantSlug} · Verify with the league office. Not a government document.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}