"use client";

import { SignIn } from "@clerk/nextjs";
import { useClerkReady } from "@/components/providers";

/**
 * Clerk's <SignIn> calls useSession() internally, so rendering it without a
 * mounted <ClerkProvider> throws during static prerender and fails the build.
 * This client boundary keeps the page itself a server component (it exports
 * `metadata`) while still gating on whether Clerk is actually available.
 */
export function ClerkSignIn() {
  const clerkReady = useClerkReady();

  if (!clerkReady) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-2xl">
        <p className="text-sm font-semibold text-foreground">
          Authentication is not configured
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY to a valid Clerk publishable key
          and redeploy.
        </p>
      </div>
    );
  }

  return (
    <SignIn
      appearance={{
        elements: {
          rootBox: "w-full",
          card: "rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/8 backdrop-blur-sm w-full",
          headerTitle: "text-foreground font-semibold",
          headerSubtitle: "text-muted-foreground",
          formFieldLabel: "text-sm font-medium text-foreground",
          formFieldInput:
            "rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary",
          formButtonPrimary:
            "bg-primary hover:bg-primary/90 rounded-lg font-semibold text-sm shadow-lg shadow-primary/20 transition-all",
          footerActionLink: "text-primary hover:text-primary/80",
          identityPreviewEditButton: "text-primary",
          dividerLine: "bg-border",
          dividerText: "text-muted-foreground text-xs",
        },
      }}
      redirectUrl="/"
      signUpUrl="/login"
    />
  );
}
