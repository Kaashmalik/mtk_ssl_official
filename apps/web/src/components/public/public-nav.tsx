"use client"

import * as React from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"

type NavItem = { label: string; href: string }

/**
 * Phone navigation for the public pages. A native <details> disclosure keeps
 * it hook-free (the home page tests execute components as plain functions)
 * and working before hydration.
 */
export function MobileNav({ items }: { items: readonly NavItem[] }) {
  const close = (e: React.MouseEvent<HTMLElement>) => e.currentTarget.closest("details")?.removeAttribute("open")
  const itemClass = "block rounded-lg px-3 py-2.5 hover:bg-muted hover:text-foreground"
  return (
    <details className="group relative md:hidden">
      <summary
        aria-label="Open navigation menu"
        className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Menu className="h-5 w-5 group-open:hidden" aria-hidden="true" />
        <X className="hidden h-5 w-5 group-open:block" aria-hidden="true" />
      </summary>
      <nav
        aria-label="Primary mobile"
        className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-card p-2 text-sm font-medium text-muted-foreground shadow-xl"
      >
        {items.map((item) =>
          item.href.startsWith("#") ? (
            <a key={item.href} href={item.href} className={itemClass} onClick={close}>
              {item.label}
            </a>
          ) : (
            <Link key={item.href} href={item.href} className={itemClass} onClick={close}>
              {item.label}
            </Link>
          ),
        )}
      </nav>
    </details>
  )
}

declare global {
  interface Window {
    googlefc?: { showRevocationMessage?: () => void; callbackQueue?: unknown[] }
  }
}

/**
 * "Cookie settings": reopens Google's consent message (the certified CMP
 * configured in AdSense > Privacy & messaging) when it is loaded; otherwise it
 * is a plain link to the cookie section of the privacy policy.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <a
      href="/privacy#cookies"
      className={className}
      onClick={(e) => {
        const show = window.googlefc?.showRevocationMessage
        if (typeof show === "function") {
          e.preventDefault()
          show()
        }
      }}
    >
      Cookie settings
    </a>
  )
}
