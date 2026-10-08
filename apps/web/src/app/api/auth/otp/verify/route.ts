import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, verificationTokens } from "@mtk/database";
import { and, eq, desc, gt, isNull } from "drizzle-orm";
import { verifyOtpHash } from "@/lib/otp";

const schema = z.object({
  identifier: z.string().min(3).max(320),
  code: z.string().length(6),
  purpose: z.enum(["registration", "password_reset", "renewal_confirm", "super_admin_2fa"]).default("registration"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, code, purpose } = schema.parse(body);

    const [token] = await db.select().from(verificationTokens)
      .where(and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.purpose, purpose),
        isNull(verificationTokens.verifiedAt),
        gt(verificationTokens.expiresAt, new Date()),
      ))
      .orderBy(desc(verificationTokens.createdAt))
      .limit(1);

    if (!token) {
      return NextResponse.json({ error: "No valid OTP found. Request a new code." }, { status: 400 });
    }

    if (token.attempts >= token.maxAttempts) {
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
    }

    const ok = verifyOtpHash(identifier, code, token.tokenHash);
    if (!ok) {
      const attempts = token.attempts + 1;
      await db.update(verificationTokens)
        .set({ attempts })
        .where(eq(verificationTokens.id, token.id));
      return NextResponse.json({ error: `Incorrect code. ${token.maxAttempts - attempts} attempts remaining.` }, { status: 400 });
    }

    await db.update(verificationTokens)
      .set({ verifiedAt: new Date() })
      .where(eq(verificationTokens.id, token.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.flatten() }, { status: 400 });
    }
    console.error("[otp/verify]", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
