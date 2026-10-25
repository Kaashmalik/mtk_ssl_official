export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/admin-auth';
import {
  db,
  tenants,
  users,
  matches,
  userTenantRoles,
  subscriptions,
  payments,
} from '@mtk/database';
import { count, eq, and, gte, sql, desc } from 'drizzle-orm';
import { getRequestLogger, captureError } from '@mtk/observability';

/**
 * GET /api/platform-metrics
 * 
 * Super admin endpoint for platform-wide metrics and analytics.
 * Returns tenant counts, user activity, match statistics, revenue data,
 * and time-series trends for dashboard visualization.
 * 
 * Query params:
 *   ?range=7d|30d|90d  Time range for trends (default: 30d)
 */
export async function GET(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = getRequestLogger();
  const range = request.nextUrl?.searchParams.get('range') || '30d';

  try {
    // Calculate date range
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const days = daysMap[range] || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // ===== TENANT METRICS =====
    const allTenants = await db
      .select({
        id: tenants.id,
        isActive: tenants.isActive,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants);

    const activeTenants = allTenants.filter((t) => t.isActive);
    const pendingTenants = allTenants.filter((t) => t.status === 'pending');
    const suspendedTenants = allTenants.filter((t) => t.status === 'suspended');

    // Calculate tenant growth
    const tenantsLastPeriod = allTenants.filter(
      (t) => new Date(t.createdAt) < startDate
    ).length;
    const tenantGrowth = tenantsLastPeriod > 0
      ? ((allTenants.length - tenantsLastPeriod) / tenantsLastPeriod) * 100
      : 0;

    // ===== USER METRICS =====
    const allUsers = await db
      .select({
        id: users.id,
        createdAt: users.createdAt,
      })
      .from(users);

    const activeUserIds = await db
      .select({ userId: userTenantRoles.userId })
      .from(userTenantRoles)
      .where(eq(userTenantRoles.status, 'active'))
      .groupBy(userTenantRoles.userId);

    const newUsersThisMonth = allUsers.filter((u) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return new Date(u.createdAt) >= thirtyDaysAgo;
    }).length;

    const usersLastPeriod = allUsers.filter(
      (u) => new Date(u.createdAt) < startDate
    ).length;
    const userGrowth = usersLastPeriod > 0
      ? ((allUsers.length - usersLastPeriod) / usersLastPeriod) * 100
      : 0;

    // ===== MATCH METRICS =====
    const allMatches = await db
      .select({
        id: matches.id,
        status: matches.status,
        scheduledAt: matches.scheduledAt,
        createdAt: matches.createdAt,
      })
      .from(matches);

    const liveMatches = allMatches.filter((m) => m.status === 'live');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const completedToday = allMatches.filter(
      (m) => m.status === 'completed' && new Date(m.createdAt) >= today
    ).length;

    const scheduledUpcoming = allMatches.filter(
      (m) => m.status === 'scheduled' && new Date(m.scheduledAt) > new Date()
    ).length;

    // ===== REVENUE METRICS =====
    const PLAN_PRICES: Record<string, number> = {
      free: 0,
      starter: 4999,
      pro: 14999,
      enterprise: 49999,
    };

    const activeSubscriptions = await db
      .select({
        tenantId: subscriptions.tenantId,
        plan: subscriptions.plan,
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));

    const mrr = activeSubscriptions.reduce(
      (sum, sub) => sum + (PLAN_PRICES[sub.plan] || 0),
      0
    );
    const arr = mrr * 12;

    // Calculate revenue growth
    const previousPeriodEnd = new Date(startDate);
    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - days);

    const previousRevenue = await db
      .select({
        plan: subscriptions.plan,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'active'),
          gte(subscriptions.createdAt, previousPeriodStart)
        )
      );

    const previousMrr = previousRevenue.reduce(
      (sum, sub) => sum + (PLAN_PRICES[sub.plan] || 0),
      0
    );
    const revenueGrowth = previousMrr > 0 ? ((mrr - previousMrr) / previousMrr) * 100 : 0;

    // ===== SYSTEM HEALTH =====
    // Simple uptime calculation (can be enhanced with actual monitoring data)
    const uptime = 99.9; // Placeholder - integrate with actual monitoring
    const apiLatency = 150; // Placeholder - integrate with actual metrics
    const errorRate = 0.5; // Placeholder - calculate from error_logs table
    const activeIncidents = 0; // Placeholder - integrate with incident tracking

    // ===== TIME-SERIES TRENDS =====
    const trends = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayTenants = allTenants.filter(
        (t) => new Date(t.createdAt) <= nextDate
      ).length;

      const dayUsers = allUsers.filter(
        (u) => new Date(u.createdAt) <= nextDate
      ).length;

      const dayMatches = allMatches.filter(
        (m) =>
          new Date(m.createdAt) >= date && new Date(m.createdAt) < nextDate
      ).length;

      // Revenue for that day (simplified - actual implementation would track daily)
      const dayRevenue = mrr / days; // Simplified daily average

      trends.push({
        date: date.toISOString().split('T')[0],
        tenants: dayTenants,
        users: dayUsers,
        matches: dayMatches,
        revenue: Math.round(dayRevenue),
      });
    }

    // ===== RESPONSE =====
    return NextResponse.json({
      tenants: {
        total: allTenants.length,
        active: activeTenants.length,
        pending: pendingTenants.length,
        suspended: suspendedTenants.length,
        growth: Math.round(tenantGrowth * 100) / 100,
      },
      users: {
        total: allUsers.length,
        active: activeUserIds.length,
        newThisMonth: newUsersThisMonth,
        growth: Math.round(userGrowth * 100) / 100,
      },
      matches: {
        total: allMatches.length,
        live: liveMatches.length,
        completedToday,
        scheduledUpcoming,
      },
      revenue: {
        mrr,
        arr,
        growth: Math.round(revenueGrowth * 100) / 100,
        currency: 'PKR',
      },
      system: {
        uptime,
        apiLatency,
        errorRate,
        activeIncidents,
      },
      trends,
    });
  } catch (error) {
    log.error('Failed to fetch platform metrics', error);
    await captureError(error, {
      level: 'error',
      context: { adminId, path: '/api/platform-metrics' },
      tags: { source: 'platform-metrics' },
    });
    return NextResponse.json(
      { error: 'Failed to fetch platform metrics' },
      { status: 500 }
    );
  }
}
