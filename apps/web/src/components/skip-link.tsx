import * as React from "react"

/**
 * Batch 123: the platform's first tab stop on every page — a skip-to-content
 * link for keyboard and screen-reader users. Visually hidden until focused
 * (`sr-only` + `focus:` reveal, the standard Tailwind a11y pattern); it
 * targets the layout's `<div id="main-content">` wrapper.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
    >
      Skip to content
    </a>
  )
}
