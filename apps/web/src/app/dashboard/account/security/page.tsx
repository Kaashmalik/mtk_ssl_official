import React from "react"
import { UserProfile } from "@clerk/nextjs"

export default function AccountSecurityPage() {
  return <main className="space-y-4">
    <h1 className="text-2xl font-bold">Account security</h1>
    <p>Privileged changes require both sign-in factors verified within the last 10 minutes. Enrol a second factor here, keep your provider recovery codes safe, and sign in again with both factors when prompted. We never bypass MFA or replace it with email-only approval.</p>
    <UserProfile routing="hash" />
  </main>
}
