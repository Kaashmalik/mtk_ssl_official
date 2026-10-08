"use client"

import { SignUp } from "@clerk/nextjs"
import { useClerkReady } from "@/components/providers"

export function ClerkSignUp() {
  const clerkReady = useClerkReady()

  if (!clerkReady) {
    return (
      <div className="rounded-xl border border-white/20 bg-white/80 p-6 text-center shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-black/50">
        <p className="text-sm font-semibold text-foreground">Authentication is not configured</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to a valid Clerk publishable key and redeploy.
        </p>
      </div>
    )
  }

  return (
    <SignUp
      fallbackRedirectUrl="/dashboard/league/setup"
      signInUrl="/sign-in"
      appearance={{
        elements: {
          rootBox: "mx-auto",
          card: "shadow-xl border border-white/20 bg-white/80 backdrop-blur-md dark:bg-black/50 dark:border-white/10 rounded-xl",
        },
        variables: {
          colorPrimary: "oklch(0.6 0.16 145)",
          colorBackground: "transparent",
        },
      }}
    />
  )
}
