export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, waitlist } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await db
      .select()
      .from(waitlist)
      .orderBy(desc(waitlist.createdAt));

    return NextResponse.json({ waitlist: data || [] });
  } catch (error) {
    console.error("Waitlist API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch waitlist" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    await db.delete(waitlist).where(eq(waitlist.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete waitlist error:", error);
    return NextResponse.json(
      { error: "Failed to delete waitlist entry" },
      { status: 500 }
    );
  }
}
