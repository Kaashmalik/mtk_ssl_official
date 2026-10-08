"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";
import { createContext, useContext } from "react";

/**
 * True only when a real Clerk publishable key was found and <ClerkProvider> is
 * actually mounted. Components that render Clerk's <SignIn>, <UserButton>, etc.
 * must check this first: those components call useSession() internally and throw
 * "useSession can only be used within the <ClerkProvider /> component" during
 * static prerender when the provider is absent, which fails the whole build.
 */
const ClerkReadyContext = createContext(false);

export function useClerkReady(): boolean {
  return useContext(ClerkReadyContext);
}

function resolveClerkPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!key) return undefined;
  if (/\[[^\]]+\]/.test(key)) return undefined;
  if (/your_|get from|placeholder|replace_with|changeme/i.test(key)) {
    return undefined;
  }
  if (!/^pk_(test|live)_/.test(key) || key.length < 40) return undefined;
  return key;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const publishableKey = resolveClerkPublishableKey();

  const themed = (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );

  if (!publishableKey) {
    return (
      <ClerkReadyContext.Provider value={false}>
        {themed}
      </ClerkReadyContext.Provider>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkReadyContext.Provider value={true}>
        {themed}
      </ClerkReadyContext.Provider>
    </ClerkProvider>
  );
}
