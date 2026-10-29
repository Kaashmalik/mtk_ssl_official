import * as React from "react"
import { PublicShell } from "@/components/public/public-shell"
import { Prose, type ProseBlock } from "@/components/public/prose"
import { LEGAL_LAST_UPDATED, formatLegalDate } from "@/lib/legal"

/** Shared layout for About / Contact / Privacy / Terms. */
export function LegalPage({
  eyebrow,
  title,
  intro,
  blocks,
  showUpdated = true,
  children,
}: {
  eyebrow: string
  title: string
  intro: string
  blocks: readonly ProseBlock[]
  showUpdated?: boolean
  children?: React.ReactNode
}) {
  return (
    <PublicShell>
      <main className="container mx-auto max-w-3xl px-6 py-12 lg:py-16">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
          <h1 className="font-display mt-3 text-[clamp(2rem,5vw,3rem)] font-extrabold leading-tight tracking-tight">{title}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{intro}</p>
          {showUpdated && (
            <p className="mt-4 text-sm text-muted-foreground">
              Last updated <time dateTime={LEGAL_LAST_UPDATED}>{formatLegalDate(LEGAL_LAST_UPDATED)}</time>
            </p>
          )}
        </header>
        {children}
        <div className="mt-10">
          <Prose blocks={blocks} />
        </div>
      </main>
    </PublicShell>
  )
}
