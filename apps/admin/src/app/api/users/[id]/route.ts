import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, users, auditLogs } from "@mtk/database";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";

// ISO-06 (Batch 165): users.role is the PLATFORM role column only.
// League roles live exclusively in user_tenant_roles, managed per league -
// the platform console can neither read them from users.role nor write
// them into it (a league-role write is a visible 400, never a silent no-op).
const PLATFORM_ROLES = ["super_admin", "fan"] as const;

const updateSchema = z
  .object({
    role: z.enum(PLATFORM_ROLES).optional(),
    isActive: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { role, isActive, reason } = parsed.data;

    // ISO-06 (Batch 165): explicit projection - no full-row read, and the
    // legacy tenant_ids column (dropped by 20261019160000) can never load.
    const [target] = await db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Never allow demoting or deactivating the last active super admin
    if (target.role === "super_admin" && (role !== "super_admin" || isActive === false)) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
      if (Number(value) <= 1) {
        return NextResponse.json({ error: "Cannot modify the last active super admin" }, { status: 409 });
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(role ? { role } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      });

    await db.insert(auditLogs).values({
      requestId: crypto.randomUUID(),
      actorId: adminId,
      actorRole: "super_admin",
      method: "PATCH",
      path: `/api/users/${id}`,
      payload: {
        action: "user.update",
        targetUserId: id,
        changes: { role, isActive },
        reason: reason ?? null,
      },
      statusCode: "200",
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}