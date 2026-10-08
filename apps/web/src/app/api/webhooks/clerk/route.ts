/**
 * Clerk Webhook — syncs Clerk user events to the `users` database table.
 *
 * Events handled:
 *   - user.created  → INSERT into users (clerk_id, email, name, avatar)
 *   - user.updated  → UPDATE users (email, name, avatar, last_login)
 *   - user.deleted  → soft-delete (is_active = false)
 *
 * Security: verifies the Svix signature using CLERK_SECRET_KEY (or the raw
 * webhook secret if set). Rejects unsigned/invalid requests.
 *
 * Route config: must run on Node runtime (uses crypto, DB). The matcher in
 * middleware.ts already excludes /api/webhooks from Clerk auth (public route).
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { headers } from "next/headers";
import { db, users } from "@mtk/database";
import { eq } from "drizzle-orm";

/**
 * Svix needs the raw body to verify the signature. The `NextRequest.text()`
 * method gives us exactly that without any JSON parsing interference.
 */
export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || process.env.CLERK_SECRET_KEY;

  // If no secret is configured, we cannot verify — fail closed.
  if (!WEBHOOK_SECRET) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET is not set — rejecting webhook.");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // ─── Verify Svix signature ───────────────────────────────────
  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  const payload = await req.text();

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: ClerkWebhookEvent;

  try {
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    console.error("[clerk-webhook] Svix signature verification failed.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventType = evt.type;
  const data = evt.data;

  // ─── Handle events ────────────────────────────────────────────
  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const clerkId = data.id;
        const email = data.email_addresses?.[0]?.email_address;
        const firstName = data.first_name ?? "";
        const lastName = data.last_name ?? "";
        const displayName = `${firstName} ${lastName}`.trim() || data.username || null;
        const avatarUrl = data.image_url || data.profile_image_url || null;

        if (!clerkId || !email) {
          console.warn(`[clerk-webhook] ${eventType}: missing clerkId or email`, { clerkId, email });
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Upsert: try INSERT first, fall back to UPDATE on conflict (clerk_id unique).
        await db
          .insert(users)
          .values({
            clerkId,
            email,
            displayName,
            avatarUrl,
            role: "fan",
            isActive: true,
            lastLoginAt: eventType === "user.updated" ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: users.clerkId,
            set: {
              email,
              displayName,
              avatarUrl,
              lastLoginAt: eventType === "user.updated" ? new Date() : undefined,
              updatedAt: new Date(),
            },
          });

        console.log(`[clerk-webhook] ${eventType}: synced user ${clerkId} (${email})`);
        break;
      }

      case "user.deleted": {
        const clerkId = data.id;
        if (!clerkId) {
          return NextResponse.json({ error: "Missing user id" }, { status: 400 });
        }

        // Soft delete — keep the row for audit trail but mark inactive.
        await db
          .update(users)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(users.clerkId, clerkId));

        console.log(`[clerk-webhook] user.deleted: deactivated user ${clerkId}`);
        break;
      }

      default:
        // Ignore other event types (session.created, etc.)
        console.log(`[clerk-webhook] Ignored event: ${eventType}`);
    }

    return NextResponse.json({ received: true, type: eventType });
  } catch (error) {
    console.error(`[clerk-webhook] Error handling ${eventType}:`, error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Also allow GET for health-check / Clerk dashboard verification.
export async function GET() {
  return NextResponse.json({ endpoint: "clerk-webhook", status: "active" });
}

// ─── Types ─────────────────────────────────────────────────────

interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    image_url?: string | null;
    profile_image_url?: string | null;
  };
}
