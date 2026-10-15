import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendOtp } from "@/lib/otp-verification";

const schema = z.object({
  identifier: z.string().min(3).max(320),
  channel: z.enum(["whatsapp", "sms", "email"]),
  purpose: z.enum(["registration", "password_reset", "renewal_confirm", "super_admin_2fa"]).default("registration"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, channel, purpose } = schema.parse(body);

    const result = await sendOtp({ identifier, channel, purpose });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "rate_limited" ? "Too many OTP requests. Try again later." : "Please wait 60 seconds before resending." },
        { status: 429 },
      );
    }
    return NextResponse.json({ success: true, mock: result.mock });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.flatten() }, { status: 400 });
    }
    console.error("[otp/send]", error);
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
