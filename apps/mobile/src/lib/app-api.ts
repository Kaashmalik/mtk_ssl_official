import Constants from "expo-constants";
import { getClerkInstance } from "@clerk/clerk-expo";

/**
 * SCORE-08: the ONLY authenticated transport for the mobile app. Requests go
 * to the web app's mobile intake API, which authenticates the Clerk session
 * token server-side and resolves league/actor authority the same way the
 * dashboard server actions do. The scoring service is never called directly
 * from the device: a leaked app bundle carries no write authority.
 *
 * Configuration comes from app.json `extra` or EXPO_PUBLIC_* env, matching
 * the existing scoringServiceUrl() convention.
 */
export function appApiUrl(): string {
  const raw =
    Constants.expoConfig?.extra?.appApiUrl ||
    process.env.EXPO_PUBLIC_APP_URL ||
    "";
  return raw.replace(/\/$/, "");
}

export function clerkConfigured(): boolean {
  return Boolean(
    Constants.expoConfig?.extra?.clerkPublishableKey ||
      process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
}

export async function currentSessionToken(): Promise<string | null> {
  return (await getClerkInstance().session?.getToken()) ?? null;
}

/** 401-propagating authenticated fetch. Never retries writes with a stale token. */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = appApiUrl();
  if (!base) throw new Error("The mobile app server URL is not configured");
  const token = await currentSessionToken();
  if (!token) throw new Error("Sign in to continue");
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}
