import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { tenants, matches, teams, users, userTenantRoles } from '@/schema';
import { eq, and } from 'drizzle-orm';

describe('Tenant Isolation - Cross-Tenant Access Prevention', () => {
  let tenant1Id: string;
  let tenant2Id: string;
  let user1Id: string;
  let user2Id: string;
  let team1Id: string;
  let team2Id: string;
  let match1Id: string;
  let match2Id: string;

  beforeEach(async () => {
    // Create two separate tenants
    const [tenant1] = await db.insert(tenants).values({
      name: 'Test League 1',
      slug: 'test-league-1',
      status: 'active'
    }).returning();
    tenant1Id = tenant1.id;

    const [tenant2] = await db.insert(tenants).values({
      name: 'Test League 2',
      slug: 'test-league-2',
      status: 'active'
    }).returning();
    tenant2Id = tenant2.id;

    // Create users for each tenant
    const [user1] = await db.insert(users).values({
      email: 'user1@test.com',
      clerkId: 'clerk_user1'
    }).returning();
    user1Id = user1.id;

    const [user2] = await db.insert(users).values({
      email: 'user2@test.com',
      clerkId: 'clerk_user2'
    }).returning();
    user2Id = user2.id;

    // Assign users to their respective tenants
    await db.insert(userTenantRoles).values([
      { userId: user1Id, tenantId: tenant1Id, role: 'organizer', status: 'active' },
      { userId: user2Id, tenantId: tenant2Id, role: 'organizer', status: 'active' }
    ]);

    // Create teams for each tenant
    const [team1] = await db.insert(teams).values({
      name: 'Team 1',
      tenantId: tenant1Id
    }).returning();
    team1Id = team1.id;

    const [team2] = await db.insert(teams).values({
      name: 'Team 2',
      tenantId: tenant2Id
    }).returning();
    team2Id = team2.id;

    // Create matches for each tenant
    const [match1] = await db.insert(matches).values({
      tenantId: tenant1Id,
      homeTeamId: team1Id,
      awayTeamId: team1Id,
      status: 'scheduled',
      scheduledAt: new Date()
    }).returning();
    match1Id = match1.id;

    const [match2] = await db.insert(matches).values({
      tenantId: tenant2Id,
      homeTeamId: team2Id,
      awayTeamId: team2Id,
      status: 'scheduled',
      scheduledAt: new Date()
    }).returning();
    match2Id = match2.id;
  });

  afterEach(async () => {
    // Cleanup
    await db.delete(matches);
    await db.delete(teams);
    await db.delete(userTenantRoles);
    await db.delete(users);
    await db.delete(tenants);
  });

  it('should prevent cross-tenant match access', async () => {
    // User 1 should only see matches from tenant 1
    const tenant1Matches = await db.select()
      .from(matches)
      .where(eq(matches.tenantId, tenant1Id));

    expect(tenant1Matches).toHaveLength(1);
    expect(tenant1Matches[0].id).toBe(match1Id);
    expect(tenant1Matches[0].tenantId).toBe(tenant1Id);

    // Verify tenant 2 match is not accessible
    const crossTenantAttempt = await db.select()
      .from(matches)
      .where(and(
        eq(matches.id, match2Id),
        eq(matches.tenantId, tenant1Id)
      ));

    expect(crossTenantAttempt).toHaveLength(0);
  });

  it('should prevent cross-tenant team access', async () => {
    const tenant1Teams = await db.select()
      .from(teams)
      .where(eq(teams.tenantId, tenant1Id));

    expect(tenant1Teams).toHaveLength(1);
    expect(tenant1Teams[0].id).toBe(team1Id);

    // Attempt to access team from another tenant
    const crossTenantTeam = await db.select()
      .from(teams)
      .where(and(
        eq(teams.id, team2Id),
        eq(teams.tenantId, tenant1Id)
      ));

    expect(crossTenantTeam).toHaveLength(0);
  });

  it('should enforce tenant context in user roles', async () => {
    // User 1 should only have role in tenant 1
    const user1Roles = await db.select()
      .from(userTenantRoles)
      .where(and(
        eq(userTenantRoles.userId, user1Id),
        eq(userTenantRoles.tenantId, tenant1Id)
      ));

    expect(user1Roles).toHaveLength(1);
    expect(user1Roles[0].role).toBe('organizer');

    // User 1 should not have role in tenant 2
    const crossTenantRole = await db.select()
      .from(userTenantRoles)
      .where(and(
        eq(userTenantRoles.userId, user1Id),
        eq(userTenantRoles.tenantId, tenant2Id)
      ));

    expect(crossTenantRole).toHaveLength(0);
  });

  it('should prevent updating resources from another tenant', async () => {
    // Attempt to update match from another tenant should fail
    const result = await db.update(matches)
      .set({ status: 'completed' })
      .where(and(
        eq(matches.id, match2Id),
        eq(matches.tenantId, tenant1Id)
      ))
      .returning();

    expect(result).toHaveLength(0);

    // Verify original match is unchanged
    const [originalMatch] = await db.select()
      .from(matches)
      .where(eq(matches.id, match2Id));

    expect(originalMatch.status).toBe('scheduled');
  });

  it('should prevent deleting resources from another tenant', async () => {
    const result = await db.delete(matches)
      .where(and(
        eq(matches.id, match2Id),
        eq(matches.tenantId, tenant1Id)
      ))
      .returning();

    expect(result).toHaveLength(0);

    // Verify match still exists
    const [match] = await db.select()
      .from(matches)
      .where(eq(matches.id, match2Id));

    expect(match).toBeDefined();
  });
});
