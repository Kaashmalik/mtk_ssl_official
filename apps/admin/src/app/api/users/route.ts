import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, users } from "@mtk/database";
import { desc, ilike, eq, and, type SQL } from "drizzle-orm";

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
    if (role) conditions.push(eq(users.role, role as typeof users.role.enumValues[number]));
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
