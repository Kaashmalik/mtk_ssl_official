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
      // Batch 147: `<` escaped so a `</script>` inside any serialized string
      // (team/tournament names are organizer-controlled) can never close the
      // raw-text script element and become DOM. HTML-escape, not JSON.
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  )
}

/**
 * JSON.stringify leaves `<` intact; inside a raw-text <script> element that
 * lets any serialized string close the tag and inject DOM. Escaping `<` to
 * \u003c is the standard hardening — it round-trips identically through
 * JSON.parse (same value, safer bytes).
 */
export function safeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
