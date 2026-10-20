export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  db,
  users,
  tenants,
  subscriptions,
  userTenantRoles,
  leagueApplications,
  leagueApplicationReplies,
  auditLogs,
  LEAGUE_APPLICATION_STATES,
  isLeagueApplicationState,
  leagueApplicationTransition,
  leagueApplicationProvisioningDecision,
} from "@mtk/database";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { captureError, getRequestLogger } from "@mtk/observability";
import { z } from "zod";

/**
 * Platform review of league applications (REG-01 first slice).
 *
 * GET lists the queue (oldest first) for the console. PATCH approves, rejects
 * or requests information. Approval and workspace provisioning are one atomic
 * decision: the applicant's `users` row is locked first (the same
 * serialization point as `createTenant` and the applicant writers), then the
 * application row, then the provisioning gate re-verifies that the account is
 * active and still owns no league. A version + state predicate carries the
 * update, so a retried or racing approval can never provision twice — the
 * partial unique index on `provisioned_tenant_id` is the second net.
 */

/** PostgreSQL unique_violation: tenants.slug is globally unique. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

const STALE = "The application changed since this page was loaded. Reload before reviewing.";
const DUPLICATE_SLUG =
  "The proposed league URL was taken while this application was pending. Request information or reject it so the applicant can choose another.";

const PROVISIONING_REFUSAL_MESSAGES: Record<string, string> = {
  "not-submitted": "This application is no longer awaiting approval.",
  "already-provisioned": "This application already provisioned a league.",
  "applicant-missing": "The applicant account no longer exists.",
  "applicant-inactive": "The applicant account is inactive.",
  "already-owns-league": "The applicant already owns a league.",
};

function toView(application: typeof leagueApplications.$inferSelect) {
  return {
    id: application.id,
    applicantId: application.applicantId,
    proposedName: application.proposedName,
    proposedSlug: application.proposedSlug,
    desiredPlan: application.desiredPlan,
    state: application.state,
    version: application.version,
    reviewReason: application.reviewReason ?? null,
    submittedAt: application.submittedAt ? application.submittedAt.toISOString() : null,
    reviewedAt: application.reviewedAt ? application.reviewedAt.toISOString() : null,
    reviewedBy: application.reviewedBy ?? null,
    provisionedTenantId: application.provisionedTenantId ?? null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("status") || "submitted";
    if (filter !== "all" && !isLeagueApplicationState(filter)) {
      return NextResponse.json({ error: "Unknown application status filter" }, { status: 400 });
    }

    const condition = filter === "all" ? undefined : eq(leagueApplications.state, filter);

    const rows = await db
      .select({
        id: leagueApplications.id,
        applicantId: leagueApplications.applicantId,
        proposedName: leagueApplications.proposedName,
        proposedSlug: leagueApplications.proposedSlug,
        desiredPlan: leagueApplications.desiredPlan,
        state: leagueApplications.state,
        version: leagueApplications.version,
        reviewReason: leagueApplications.reviewReason,
        submittedAt: leagueApplications.submittedAt,
        reviewedAt: leagueApplications.reviewedAt,
        reviewedBy: leagueApplications.reviewedBy,
        provisionedTenantId: leagueApplications.provisionedTenantId,
        createdAt: leagueApplications.createdAt,
        updatedAt: leagueApplications.updatedAt,
        applicantEmail: users.email,
        applicantName: users.displayName,
        applicantActive: users.isActive,
      })
      .from(leagueApplications)
      .innerJoin(users, eq(leagueApplications.applicantId, users.id))
      .where(condition)
      .orderBy(asc(leagueApplications.createdAt));

    // ENH-02-02: the persisted applicant thread travels with each
    // application so a reviewer reads the answers next to the request.
    const applicationIds = rows.map((row) => row.id);
    const replyRows = applicationIds.length
      ? await db
          .select()
          .from(leagueApplicationReplies)
          .where(inArray(leagueApplicationReplies.applicationId, applicationIds))
          .orderBy(asc(leagueApplicationReplies.createdAt))
      : [];
    const repliesByApplication = new Map<string, Array<{ id: string; body: string; createdAt: string }>>();
    for (const reply of replyRows) {
      const thread = repliesByApplication.get(reply.applicationId) ?? [];
      thread.push({ id: reply.id, body: reply.body, createdAt: reply.createdAt.toISOString() });
      repliesByApplication.set(reply.applicationId, thread);
    }

    return NextResponse.json({
      applications: rows.map((row) => ({
        id: row.id,
        applicantId: row.applicantId,
        proposedName: row.proposedName,
        proposedSlug: row.proposedSlug,
        desiredPlan: row.desiredPlan,
        state: row.state,
        version: row.version,
        reviewReason: row.reviewReason ?? null,
        submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        reviewedBy: row.reviewedBy ?? null,
        provisionedTenantId: row.provisionedTenantId ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        applicantEmail: row.applicantEmail,
        applicantName: row.applicantName ?? null,
        applicantActive: row.applicantActive === true,
        replies: repliesByApplication.get(row.id) ?? [],
      })),
      states: LEAGUE_APPLICATION_STATES,
    });
  } catch (error) {
    getRequestLogger().error("List league applications error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/league-applications" },
      tags: { source: "league-applications", method: "GET" },
    });
    return NextResponse.json({ error: "Failed to list league applications" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bodySchema = z.object({
      applicationId: z.string().uuid(),
      action: z.enum(["approve", "reject", "request_information"]),
      expectedVersion: z.number().int().min(0).max(2147483646),
      reason: z.string().max(1000).optional().nullable(),
    });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { applicationId, action, expectedVersion, reason } = parsed.data;
    const trimmedReason = reason?.trim() || null;
    if ((action === "reject" || action === "request_information") && !trimmedReason) {
      return NextResponse.json(
        { error: action === "reject" ? "A rejection reason is required" : "A reason is required" },
        { status: 400 },
      );
    }

    let review;
    try {
      review = await db.transaction(async (tx) => {
        // Resolve the applicant first (no lock): the row lock order must match
        // the applicant writers and createTenant — user, then application — so
        // a parallel self-service creation and this approval serialize instead
        // of deadlocking.
        const [pre] = await tx
          .select()
          .from(leagueApplications)
          .where(eq(leagueApplications.id, applicationId))
          .limit(1);
        if (!pre) return { kind: "not-found" as const };

        // ISO-06 (Batch 165): explicit projection even for the lock - the
        // applicant row is read for its activity flag only, never as a
        // full row, so retired columns can never load here either.
        const [applicant] = await tx
          .select({ id: users.id, isActive: users.isActive })
          .from(users)
          .where(eq(users.id, pre.applicantId))
          .for("update")
          .limit(1);

        const [application] = await tx
          .select()
          .from(leagueApplications)
          .where(eq(leagueApplications.id, applicationId))
          .for("update")
          .limit(1);
        if (!application) return { kind: "not-found" as const };
        if (application.version !== expectedVersion) return { kind: "stale" as const };

        const verdict = leagueApplicationTransition(application.state, action);
        if (verdict.outcome === "refused") {
          return { kind: "conflict" as const, message: "This action is not allowed from the current state. Reload to see the latest status." };
        }

        const now = new Date();

        if (action === "approve") {
          const [owned] = await tx
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.ownerId, application.applicantId))
            .limit(1);

          const decision = leagueApplicationProvisioningDecision({
            state: application.state,
            provisionedTenantId: application.provisionedTenantId,
            applicant: applicant ?? null,
            ownedTenant: owned ?? null,
          });
          if (decision.outcome === "refused") {
            return { kind: "conflict" as const, message: PROVISIONING_REFUSAL_MESSAGES[decision.code] || "This application cannot be approved." };
          }

          // Provision the free-tier workspace exactly like createTenant does.
          const [createdTenant] = await tx
            .insert(tenants)
            .values({
              name: application.proposedName,
              slug: application.proposedSlug,
              customDomain: null,
              ownerId: application.applicantId,
              plan: "free",
              isActive: true,
            })
            .returning();

          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          await tx.insert(subscriptions).values({
            tenantId: createdTenant.id,
            plan: "free",
            status: "active",
            monthlyAmount: "0",
            currency: "PKR",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          });

          await tx.insert(userTenantRoles).values({
            userId: application.applicantId,
            tenantId: createdTenant.id,
            role: "league_owner",
            isPrimary: true,
          }).onConflictDoNothing({
            target: [userTenantRoles.userId, userTenantRoles.tenantId],
          });

          const [updated] = await tx
            .update(leagueApplications)
            .set({
              state: "approved",
              reviewReason: null,
              reviewedBy: adminId,
              reviewedAt: now,
              provisionedTenantId: createdTenant.id,
              version: sql`${leagueApplications.version} + 1`,
              updatedAt: now,
            })
            .where(sql`${leagueApplications.id} = ${application.id} AND ${leagueApplications.state} = 'submitted' AND ${leagueApplications.version} = ${expectedVersion}`)
            .returning();
          if (!updated) return { kind: "stale" as const };

          await tx.insert(auditLogs).values({
            requestId: randomUUID(),
            tenantId: createdTenant.id,
            actorId: adminId,
            actorRole: "super_admin",
            method: "LEAGUE_APPLICATION_APPROVE",
            path: "/league-applications",
            statusCode: "200",
            payload: {
              applicationId: updated.id,
              tenantId: createdTenant.id,
              slug: createdTenant.slug,
              desiredPlan: application.desiredPlan,
            },
          });
          return { kind: "updated" as const, application: updated };
        }

        // request_information | reject
        const [updated] = await tx
          .update(leagueApplications)
          .set({
            state: verdict.nextState,
            reviewReason: trimmedReason,
            reviewedBy: adminId,
            reviewedAt: now,
            version: sql`${leagueApplications.version} + 1`,
            updatedAt: now,
          })
          .where(sql`${leagueApplications.id} = ${application.id} AND ${leagueApplications.state} = ${application.state} AND ${leagueApplications.version} = ${expectedVersion}`)
          .returning();
        if (!updated) return { kind: "stale" as const };

        await tx.insert(auditLogs).values({
          requestId: randomUUID(),
          tenantId: null,
          actorId: adminId,
          actorRole: "super_admin",
          method: action === "reject" ? "LEAGUE_APPLICATION_REJECT" : "LEAGUE_APPLICATION_REQUEST_INFORMATION",
          path: "/league-applications",
          statusCode: "200",
          payload: {
            applicationId: updated.id,
            state: updated.state,
            reason: trimmedReason,
          },
        });
        return { kind: "updated" as const, application: updated };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The slug was claimed between submission and approval; the
        // transaction rolled back, so the application stays `submitted`.
        return NextResponse.json({ error: DUPLICATE_SLUG }, { status: 409 });
      }
      throw error;
    }

    if (review.kind === "not-found") return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (review.kind === "stale") return NextResponse.json({ error: STALE }, { status: 409 });
    if (review.kind === "conflict") return NextResponse.json({ error: review.message }, { status: 409 });
    return NextResponse.json({ application: toView(review.application) });
  } catch (error) {
    getRequestLogger().error("Review league application error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/league-applications" },
      tags: { source: "league-applications", method: "PATCH" },
    });
    return NextResponse.json({ error: "Failed to review the league application" }, { status: 500 });
  }
}
