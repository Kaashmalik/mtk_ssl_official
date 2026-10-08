export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, announcements } from "@mtk/database";
import { desc } from "drizzle-orm";

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));

    return NextResponse.json({ announcements: data || [] });
  } catch (error) {
    console.error("Announcements API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch announcements" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, message, type, priority, targetAudience, startDate, endDate, actionUrl, actionText } = body;

    if (!title || !message) {
      return NextResponse.json(
        { error: "Title and message are required" },
        { status: 400 }
      );
    }

    const [data] = await db
      .insert(announcements)
      .values({
        title,
        message,
        type: type || "info",
        priority: priority || "medium",
        targetAudience: targetAudience || "all",
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        actionUrl: actionUrl || null,
        actionText: actionText || null,
        createdBy: adminId,
        isActive: true,
      })
      .returning();

    return NextResponse.json({ announcement: data });
  } catch (error) {
    console.error("Create announcement error:", error);
    return NextResponse.json(
      { error: "Failed to create announcement" },
      { status: 500 }
    );
  }
}


