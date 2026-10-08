import { ClerkSignUp } from "./clerk-sign-up"

export default function SignUpPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-linear-to-br from-green-50 to-emerald-100 dark:from-gray-900 dark:to-gray-800 px-4 py-12">
      <div className="pointer-events-none absolute left-1/4 top-0 h-96 w-96 rounded-full bg-primary/20 blur-[128px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-[128px]" />
      <div className="relative z-10 w-full max-w-md space-y-5">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Shakir Super League</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Create your SSL account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a league on Free, or accept a league invitation after signing up.
          </p>
        </div>
        <ClerkSignUp />
      </div>
    </main>
  )
}
