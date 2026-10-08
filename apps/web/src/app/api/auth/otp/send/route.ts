import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, verificationTokens } from "@mtk/database";
import { and, eq, gte } from "drizzle-orm";
import { generateOtpCode, hashOtp, dispatchOtp, OTP_TTL_MS, OTP_MAX_PER_HOUR, OTP_RESEND_COOLDOWN_MS } from "@/lib/otp";

const schema = z.object({
  identifier: z.string().min(3).max(320),
  channel: z.enum(["whatsapp", "sms", "email"]),
  purpose: z.enum(["registration", "password_reset", "renewal_confirm", "super_admin_2fa"]).default("registration"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, channel, purpose } = schema.parse(body);

    // Rate limit: max OTP_MAX_PER_HOUR requests in the last hour per identifier+purpose
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await db.select().from(verificationTokens)
      .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.purpose, purpose), gte(verificationTokens.createdAt, oneHourAgo)));
    if (recent.length >= OTP_MAX_PER_HOUR) {
      return NextResponse.json({ error: "Too many OTP requests. Try again later." }, { status: 429 });
    }

    // Cooldown: last request must be >= OTP_RESEND_COOLDOWN_MS ago
    const last = recent.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      return NextResponse.json({ error: "Please wait 60 seconds before resending." }, { status: 429 });
    }

    const code = generateOtpCode();
    await db.insert(verificationTokens).values({
      identifier,
      tokenHash: hashOtp(identifier, code),
      channel,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const { mock } = await dispatchOtp(channel, identifier, code);
    return NextResponse.json({ success: true, mock });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.flatten() }, { status: 400 });
    }
    console.error("[otp/send]", error);
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
