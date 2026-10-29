import * as React from "react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { CookieSettingsLink } from "@/components/public/public-nav"
import { LEGAL_NAV, OPERATOR, PUBLIC_NAV } from "@/lib/legal"

/**
 * Footer for every public page. Hook-free (the home page renders it inside
 * its plain-function tests). Carries the legal links AdSense reviewers look
 * for and names the operator, which stays the platform's on white-labelled
 * hosts because the operator is who runs the service.
 */
export function SiteFooter({ brandName, logoUrl }: { brandName: string; logoUrl?: string }) {
  const year = new Date().getFullYear()
  const linkClass = "hover:text-foreground"
  return (
    <footer className="relative z-10 border-t border-border">
      <div className="container mx-auto grid gap-10 px-6 py-12 text-sm text-muted-foreground md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="flex items-center gap-2.5 font-semibold text-foreground">
            {logoUrl ? (
              <img src={logoUrl} alt="" aria-hidden="true" className="h-7 w-7 shrink-0 rounded-md object-contain" />
            ) : (
              <BrandMark idPrefix="footer-mark" className="h-7 w-7 shrink-0" />
            )}
            <span>{brandName}</span>
          </p>
          <p className="max-w-sm leading-relaxed">
            Cricket league management and ball-by-ball live scoring for organizers, scorers, players and fans.
          </p>
          <p>
            Operated by {OPERATOR.company}, {OPERATOR.city}, {OPERATOR.country}.
          </p>
        </div>
        <nav aria-label="Explore" className="flex flex-col gap-2">
          <p className="font-semibold text-foreground">Explore</p>
          {PUBLIC_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass}>
              {item.label}
            </Link>
          ))}
          <Link href="/hall-of-fame" className={linkClass}>Hall of fame</Link>
        </nav>
        <nav aria-label="Company" className="flex flex-col gap-2">
          <p className="font-semibold text-foreground">Company</p>
          {LEGAL_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass}>
              {item.label}
            </Link>
          ))}
          <CookieSettingsLink className={`${linkClass} cursor-pointer`} />
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="container mx-auto px-6 py-5 text-xs text-muted-foreground">
          © {year} {brandName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
