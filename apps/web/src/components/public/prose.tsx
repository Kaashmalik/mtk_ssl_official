import * as React from "react"
import Link from "next/link"
import { Lightbulb } from "lucide-react"

/**
 * Structured long-form content for guides and policy pages. Content is data
 * (not raw HTML) so it can never inject markup, and headings get stable ids
 * for the table of contents and deep links.
 */
export type ProseBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string; id?: string }
  | { type: "h3"; text: string }
  | { type: "ul" | "ol"; items: readonly string[] }
  | { type: "table"; caption?: string; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { type: "tip"; text: string }

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

export function headingId(block: Extract<ProseBlock, { type: "h2" }>): string {
  return block.id ?? slugifyHeading(block.text)
}

export function proseWordCount(blocks: readonly ProseBlock[]): number {
  const text = blocks
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : [...b.head, ...b.rows.flat()].join(" ")))
    .join(" ")
  return text.split(/\s+/).filter(Boolean).length
}

/** At ~200 words a minute, never less than one. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200))
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g
const linkClass = "font-medium text-primary underline underline-offset-4 hover:no-underline"

/** Inline markup: [label](href) links and **bold**. Everything else is text. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const [, label, href, bold] = match
    if (bold) {
      parts.push(<strong key={index} className="font-semibold text-foreground">{bold}</strong>)
    } else if (href.startsWith("/") || href.startsWith("#")) {
      parts.push(<Link key={index} href={href} className={linkClass}>{label}</Link>)
    } else {
      parts.push(
        <a key={index} href={href} className={linkClass} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer">
          {label}
        </a>,
      )
    }
    last = index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

export function Prose({ blocks }: { blocks: readonly ProseBlock[] }) {
  return (
    <div className="space-y-5 text-[1.0625rem] leading-relaxed text-foreground/90">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return <p key={i}><Inline text={block.text} /></p>
          case "h2":
            return (
              <h2 key={i} id={headingId(block)} className="font-display scroll-mt-24 pt-6 text-2xl font-bold tracking-tight text-foreground">
                {block.text}
              </h2>
            )
          case "h3":
            return <h3 key={i} className="pt-2 text-lg font-semibold text-foreground">{block.text}</h3>
          case "ul":
          case "ol": {
            const List = block.type
            return (
              <List key={i} className={`space-y-2 ps-6 ${block.type === "ul" ? "list-disc" : "list-decimal"} marker:text-primary`}>
                {block.items.map((item, j) => (
                  <li key={j} className="ps-1"><Inline text={item} /></li>
                ))}
              </List>
            )
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  {block.caption && <caption className="px-4 pt-3 text-left text-xs text-muted-foreground">{block.caption}</caption>}
                  <thead className="bg-muted/60">
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell} scope="col" className="px-4 py-3 font-semibold text-foreground">{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="px-4 py-3 tabular-nums">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case "tip":
            return (
              <aside key={i} className="flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-base">
                <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <p><Inline text={block.text} /></p>
              </aside>
            )
        }
      })}
    </div>
  )
}
