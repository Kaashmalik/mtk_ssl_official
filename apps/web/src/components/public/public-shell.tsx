import * as React from "react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { MobileNav } from "@/components/public/public-nav"
import { SiteFooter } from "@/components/public/site-footer"
import { PUBLIC_NAV } from "@/lib/legal"
import { readRequestBrand } from "@/lib/request-brand"
import { resolveBrandName } from "@/lib/white-label-metadata"

/**
 * Header + footer chrome for public, crawlable pages (guides, policies, hub,
 * tournaments, leaderboards, hall of fame). Before this those pages had no
 * navigation at all: a visitor or crawler landing on /hub could not reach
 * anything else. Brand is the same request-local read the head metadata uses.
 */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const brand = await readRequestBrand()
  const brandName = resolveBrandName(brand)
  const logoUrl = brand?.logoUrl
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            {logoUrl ? (
              <img src={logoUrl} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            ) : (
              <BrandMark idPrefix="shell-mark" className="h-8 w-8 shrink-0" />
            )}
            <span className="font-display truncate font-bold tracking-tight">{brandName}</span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            {PUBLIC_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:inline-flex"
            >
              Sign in
            </Link>
            <MobileNav items={[...PUBLIC_NAV, { label: "Sign in", href: "/sign-in" }]} />
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <SiteFooter brandName={brandName} logoUrl={logoUrl} />
    </div>
  )
}
