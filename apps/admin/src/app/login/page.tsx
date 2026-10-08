import type { Metadata } from "next";
import { ShieldCheck, Lock } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { ClerkSignIn } from "./clerk-sign-in";

export const metadata: Metadata = buildMetadata({
  title: "Sign In",
  description: "Secure sign-in for authorised SSL super administrators only.",
  path: "/login",
});

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center bg-background">
      {/* Decorative blobs */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full opacity-20 blur-3xl"
        style={{ background: "oklch(0.55 0.22 280)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full opacity-15 blur-3xl"
        style={{ background: "oklch(0.6 0.18 220)" }}
      />

      <div className="relative z-10 w-full max-w-[420px] px-4 space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center rounded-2xl bg-primary p-3 shadow-xl shadow-primary/30">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              SSL Super Admin
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Shakir Super League — Control Panel
            </p>
          </div>
        </div>

        {/* Clerk sign-in card */}
        <ClerkSignIn />

        {/* Security note */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>Access restricted to authorised administrators only.</span>
        </div>
      </div>
    </div>
  );
}
