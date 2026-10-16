import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, users } from "@mtk/database";
import { desc, ilike, eq, and, type SQL } from "drizzle-orm";

// The platform console lists platform-role carriers only. users.role no
// longer carries league roles (ISO-06): those live exclusively in
// user_tenant_roles and are managed per league, so filtering this
// platform-wide directory by them is a visible 400, never a silent miss.
const PLATFORM_ROLE_FILTERS = ["super_admin", "fan"] as const;

export async function GET(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const role = searchParams.get("role");
    const status = searchParams.get("status");

    const conditions: SQL[] = [];
    if (search) conditions.push(ilike(users.email, `%${search}%`));
    if (role) {
      if (!(PLATFORM_ROLE_FILTERS as readonly string[]).includes(role)) {
        return NextResponse.json(
          { error: "League roles are managed per league; filter by a platform role (super_admin, fan)" },
          { status: 400 },
        );
      }
      conditions.push(eq(users.role, role as (typeof PLATFORM_ROLE_FILTERS)[number]));
    }
    if (status === "active") conditions.push(eq(users.isActive, true));
    if (status === "suspended") conditions.push(eq(users.isActive, false));

    const list = await db.select().from(users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(200);

    return NextResponse.json({ users: list });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
