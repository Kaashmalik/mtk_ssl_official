import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyLatestOtp } from "@/lib/otp-verification";

const schema = z.object({
  identifier: z.string().min(3).max(320),
  code: z.string().length(6),
  purpose: z.enum(["registration", "password_reset", "renewal_confirm", "super_admin_2fa"]).default("registration"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier, code, purpose } = schema.parse(body);

    const result = await verifyLatestOtp({ identifier, purpose, code });
    if (result.ok) {
      return NextResponse.json({ success: true });
    }
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "No valid OTP found. Request a new code." }, { status: 400 });
    }
    if (result.reason === "exhausted") {
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Incorrect code. ${result.remaining} attempts remaining.` },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.flatten() }, { status: 400 });
    }
    console.error("[otp/verify]", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
