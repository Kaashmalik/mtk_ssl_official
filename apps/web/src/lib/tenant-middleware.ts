import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs';
import { db } from '@/lib/db';
import { userTenantRoles, auditLogs } from '@/schema';
import { eq, and } from 'drizzle-orm';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: string;
  permissions: string[];
}

export class TenantContextError extends Error {
  constructor(message: string, public statusCode: number = 403) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Get tenant context from authenticated user
 * Validates user membership and returns tenant information
 */
export async function getTenantContext(
  tenantId: string
): Promise<TenantContext> {
  const { userId } = auth();

  if (!userId) {
    throw new TenantContextError('Unauthorized', 401);
  }

  // Verify user has active membership in the tenant
  const [membership] = await db
    .select()
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.tenantId, tenantId),
        eq(userTenantRoles.status, 'active')
      )
    )
    .limit(1);

  if (!membership) {
    throw new TenantContextError(
      'User does not have access to this tenant',
      403
    );
  }

  // Get role permissions
  const permissions = getRolePermissions(membership.role);

  return {
    userId,
    tenantId,
    role: membership.role,
    permissions
  };
}

/**
 * Validate tenant access for API routes
 * Middleware function to be used in API route handlers
 */
export async function validateTenantAccess(
  req: NextRequest,
  tenantId: string,
  requiredPermission?: string
): Promise<TenantContext> {
  const context = await getTenantContext(tenantId);

  // Check rate limiting
  await checkRateLimit(context.userId, context.tenantId);

  // Verify permission if required
  if (requiredPermission && !context.permissions.includes(requiredPermission)) {
    await logAuditEvent({
      userId: context.userId,
      tenantId: context.tenantId,
      action: 'access_denied',
      resource: requiredPermission,
      metadata: { reason: 'insufficient_permissions' }
    });

    throw new TenantContextError(
      `Permission denied: ${requiredPermission}`,
      403
    );
  }

  // Log successful access
  await logAuditEvent({
    userId: context.userId,
    tenantId: context.tenantId,
    action: 'access_granted',
    resource: req.nextUrl.pathname,
    metadata: { method: req.method }
  });

  return context;
}

/**
 * Rate limiting per tenant
 * Prevents abuse and ensures fair resource usage
 */
async function checkRateLimit(
  userId: string,
  tenantId: string
): Promise<void> {
  const key = `ratelimit:${tenantId}:${userId}`;
  const limit = 100; // requests per minute
  const window = 60; // seconds

  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, window);
  }

  if (current > limit) {
    throw new TenantContextError(
      'Rate limit exceeded. Please try again later.',
      429
    );
  }
}

/**
 * Audit logging for tenant operations
 * Records all tenant-scoped actions for compliance
 */
async function logAuditEvent(event: {
  userId: string;
  tenantId: string;
  action: string;
  resource: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: event.userId,
      tenantId: event.tenantId,
      action: event.action,
      resource: event.resource,
      metadata: event.metadata || {},
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Get permissions for a role
 * Centralized permission management
 */
function getRolePermissions(role: string): string[] {
  const rolePermissions: Record<string, string[]> = {
    super_admin: ['*'], // All permissions
    organizer: [
      'tenant.read',
      'tenant.update',
      'tournament.create',
      'tournament.read',
      'tournament.update',
      'tournament.delete',
      'match.create',
      'match.read',
      'match.update',
      'team.create',
      'team.read',
      'team.update',
      'team.delete',
      'player.create',
      'player.read',
      'player.update',
      'player.delete',
      'scorer.assign'
    ],
    scorer: [
      'match.read',
      'match.score',
      'match.update_status'
    ],
    captain: [
      'team.read',
      'player.read',
      'match.read'
    ],
    player: [
      'match.read',
      'team.read',
      'player.read'
    ],
    fan: [
      'match.read',
      'team.read',
      'player.read',
      'tournament.read'
    ]
  };

  return rolePermissions[role] || [];
}

/**
 * Check if user has specific permission
 */
export function hasPermission(
  context: TenantContext,
  permission: string
): boolean {
  return (
    context.permissions.includes('*') ||
    context.permissions.includes(permission)
  );
}

/**
 * Middleware wrapper for API routes
 * Usage: export const GET = withTenantContext(handler, 'match.read');
 */
export function withTenantContext(
  handler: (req: NextRequest, context: TenantContext) => Promise<NextResponse>,
  requiredPermission?: string
) {
  return async (req: NextRequest) => {
    try {
      // Extract tenant ID from URL or body
      const tenantId = req.nextUrl.searchParams.get('tenantId') ||
                      req.headers.get('x-tenant-id');

      if (!tenantId) {
        return NextResponse.json(
          { error: 'Tenant ID is required' },
          { status: 400 }
        );
      }

      const context = await validateTenantAccess(
        req,
        tenantId,
        requiredPermission
      );

      return await handler(req, context);
    } catch (error) {
      if (error instanceof TenantContextError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.statusCode }
        );
      }

      console.error('Tenant context error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
