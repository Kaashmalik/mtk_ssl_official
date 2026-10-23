import React from "react"

/**
 * Batch 118: a generic JSON-LD emitter. Server components pass an already
 * validated data object; the emitter only serializes it. Kept separate from
 * any data derivation so the claims live where the READS live, and this
 * component stays trivially auditable (it invents nothing).
 */
export function JsonLd({ data }: { data: object }): React.ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
