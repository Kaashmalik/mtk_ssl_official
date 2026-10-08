export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, venues, tenants } from "@mtk/database";
import { eq, and } from "drizzle-orm";

// GET /api/venues - List all venues
export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  try {
    const conditions: any[] = [];
    if (tenantId) {
      conditions.push(eq(venues.tenantId, tenantId));
    }

    const data = await db
      .select({
        id: venues.id,
        tenantId: venues.tenantId,
        name: venues.name,
        address: venues.address,
        city: venues.city,
        state: venues.state,
        country: venues.country,
        capacity: venues.capacity,
        groundType: venues.groundType,
        isActive: venues.isActive,
        createdAt: venues.createdAt,
        updatedAt: venues.updatedAt,
        tenants: {
          name: tenants.name
        }
      })
      .from(venues)
      .leftJoin(tenants, eq(venues.tenantId, tenants.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(venues.name);

    const mappedVenues = data.map((v) => ({
      id: v.id,
      tenant_id: v.tenantId,
      name: v.name,
      address: v.address,
      city: v.city,
      state: v.state,
      country: v.country,
      capacity: v.capacity,
      ground_type: v.groundType,
      is_active: v.isActive,
      created_at: v.createdAt.toISOString(),
      updated_at: v.updatedAt.toISOString(),
      tenants: v.tenants,
    }));

    return NextResponse.json({ venues: mappedVenues });
  } catch (error) {
    console.error("Error fetching venues:", error);
    return NextResponse.json(
      { error: "Failed to fetch venues" },
      { status: 500 }
    );
  }
}

// POST /api/venues - Create new venue
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      tenant_id,
      name,
      address,
      city,
      state,
      country,
      capacity,
      ground_type,
    } = body;

    if (!tenant_id || !name) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const [venue] = await db
      .insert(venues)
      .values({
        tenantId: tenant_id,
        name,
        address: address || null,
        city: city || null,
        state: state || null,
        country: country || null,
        capacity: capacity ? parseInt(capacity) : null,
        groundType: ground_type || null,
        isActive: true,
      })
      .returning();

    const mappedVenue = {
      id: venue.id,
      tenant_id: venue.tenantId,
      name: venue.name,
      address: venue.address,
      city: venue.city,
      state: venue.state,
      country: venue.country,
      capacity: venue.capacity,
      ground_type: venue.groundType,
      is_active: venue.isActive,
    };

    return NextResponse.json({ venue: mappedVenue }, { status: 201 });
  } catch (error) {
    console.error("Error creating venue:", error);
    return NextResponse.json(
      { error: "Failed to create venue" },
      { status: 500 }
    );
  }
}

