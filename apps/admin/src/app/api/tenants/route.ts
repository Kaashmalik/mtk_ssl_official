export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tenants, tenantBranding, tournaments, teams, userTenantRoles, users, subscriptions, auditLogs } from "@mtk/database";
import { desc, eq, count, countDistinct } from "drizzle-orm";
import { z } from "zod";

// GET /api/tenants - List all tenants
export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tenantsList = await db
      .select()
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    const tenantsWithCounts = await Promise.all(
      tenantsList.map(async (tenant) => {
        const [branding] = await db
          .select()
          .from(tenantBranding)
          .where(eq(tenantBranding.tenantId, tenant.id))
          .limit(1);

        const tournamentsCountResult = await db
          .select({ count: count() })
          .from(tournaments)
          .where(eq(tournaments.tenantId, tenant.id));

        const teamsCountResult = await db
          .select({ count: count() })
          .from(teams)
          .where(eq(teams.tenantId, tenant.id));

        // Authoritative membership linkage (ISO-06): user_tenant_roles rows,
        // not the retired users.tenant_ids fallback array.
        const usersCountResult = await db
          .select({ count: countDistinct(userTenantRoles.userId) })
          .from(userTenantRoles)
          .where(eq(userTenantRoles.tenantId, tenant.id));

        return {
          ...tenant,
          tenant_branding: branding || null,
          tournaments: [{ count: tournamentsCountResult[0]?.count ?? 0 }],
          teams: [{ count: teamsCountResult[0]?.count ?? 0 }],
          users: [{ count: usersCountResult[0]?.count ?? 0 }],
        };
      })
    );

    return NextResponse.json({ tenants: tenantsWithCounts });
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return NextResponse.json(
      { error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

// POST /api/tenants - Create new tenant (manual admin create)
//
// ENH-02-03: a manual create previously inserted ONLY the tenant (+branding)
// with no lock, no ownership cap, no membership, no subscription and no
// audit — the manual path could duplicate ownership against a parallel
// self-service creation or leave an ownerless/inaccessible workspace. It now
// mirrors the approval provisioning chain in the league-applications route
// exactly: user row lock first (the shared serialization point), cap
// re-check under the lock, tenant + free subscription + owner membership in
// one transaction, then the audit record.
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bodySchema = z.object({
      name: z.string().min(2).max(120),
      slug: z
        .string()
        .min(2)
        .max(60)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
      // tenants.owner_id is a UUID referencing users.id — never a Clerk id.
      owner_id: z.string().uuid(),
      logo_url: z.string().url().optional().nullable(),
    });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { name, slug, owner_id, logo_url } = parsed.data;

    function isUniqueViolation(error: unknown): boolean {
      return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
    }

    const created = await db.transaction(async (tx) => {
      // Lock order matches createTenant and the approval provisioning: the
      // owner's user row first, so a parallel self-service creation and this
      // manual create serialize instead of deadlocking.
      const [owner] = await tx
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, owner_id))
        .for("update")
        .limit(1);
      if (!owner) return { kind: "no-owner" as const };
      if (owner.isActive !== true) return { kind: "owner-inactive" as const };

      // One owned league per account — re-checked UNDER the lock because the
      // pre-check is racy and tenants.owner_id has no unique constraint.
      const [alreadyOwned] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerId, owner.id))
        .limit(1);
      if (alreadyOwned) return { kind: "already-owns" as const };

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      try {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            name,
            slug,
            customDomain: null,
            ownerId: owner.id,
            plan: "free",
            isActive: true,
          })
          .returning();

        await tx.insert(subscriptions).values({
          tenantId: tenant.id,
          plan: "free",
          status: "active",
          monthlyAmount: "0",
          currency: "PKR",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        });

        await tx.insert(userTenantRoles).values({
          userId: owner.id,
          tenantId: tenant.id,
          role: "league_owner",
          isPrimary: true,
        }).onConflictDoNothing({
          target: [userTenantRoles.userId, userTenantRoles.tenantId],
        });

        await tx.insert(tenantBranding).values({
          tenantId: tenant.id,
          logoUrl: logo_url ?? null,
          hideSslBranding: false,
        });

        await tx.insert(auditLogs).values({
          requestId: randomUUID(),
          tenantId: tenant.id,
          actorId: adminId,
          actorRole: "super_admin",
          method: "ADMIN_TENANT_CREATE",
          path: "/tenants",
          statusCode: "200",
          payload: { tenantId: tenant.id, slug: tenant.slug, ownerId: owner.id },
        });

        return { kind: "created" as const, tenant };
      } catch (error) {
        // The slug row-level unique index is the authority.
        if (isUniqueViolation(error)) return { kind: "slug-taken" as const };
        throw error;
      }
    });

    if (created.kind === "no-owner") {
      return NextResponse.json({ error: "Owner account not found" }, { status: 404 });
    }
    if (created.kind === "owner-inactive") {
      return NextResponse.json({ error: "Owner account is inactive" }, { status: 409 });
    }
    if (created.kind === "already-owns") {
      return NextResponse.json({ error: "This account already owns a league" }, { status: 409 });
    }
    if (created.kind === "slug-taken") {
      return NextResponse.json({ error: "This league URL is already taken" }, { status: 409 });
    }

    return NextResponse.json({ tenant: created.tenant }, { status: 201 });
  } catch (error) {
    console.error("Error creating tenant:", error);
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 }
    );
  }
}

