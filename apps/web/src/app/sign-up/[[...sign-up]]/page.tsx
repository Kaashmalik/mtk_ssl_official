import React from "react"
import { readRequestBrand } from "@/lib/request-brand"
import { resolveBrandName, shortTenantLabel } from "@/lib/white-label-metadata"
import { ClerkSignUp } from "./clerk-sign-up"

export default async function SignUpPage() {
  // Batch 125: the sign-up screen is the tenant's too — a branded league's
  // invite link should read like the league's own product. Host-tenant
  // resolution needs no auth; the platform brand remains the fallback.
  const brand = await readRequestBrand()
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-linear-to-br from-green-50 to-emerald-100 dark:from-gray-900 dark:to-gray-800 px-4 py-12">
      <div className="pointer-events-none absolute left-1/4 top-0 h-96 w-96 rounded-full bg-primary/20 blur-[128px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-[128px]" />
      <div className="relative z-10 w-full max-w-md space-y-5">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{resolveBrandName(brand)}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{`Create your ${shortTenantLabel(brand)} account`}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a league on Free, or accept a league invitation after signing up.
          </p>
        </div>
        <ClerkSignUp />
      </div>
    </main>
  )
}
