import { createHmac, randomInt, timingSafeEqual } from "crypto";

const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_PER_HOUR = 3;

function secret(): string {
  return process.env.OTP_HMAC_SECRET || process.env.CLERK_SECRET_KEY || "dev-otp-secret";
}

export function generateOtpCode(): string {
  return randomInt(0, 1000000).toString().padStart(OTP_LENGTH, "0");
}

export function hashOtp(identifier: string, code: string): string {
  return createHmac("sha256", secret()).update(`${identifier}:${code}`).digest("hex");
}

export function verifyOtpHash(identifier: string, code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtp(identifier, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type OtpChannel = "whatsapp" | "sms" | "email";

export async function dispatchOtp(channel: OtpChannel, identifier: string, code: string): Promise<{ mock: boolean }> {
  const message = `Your SSL verification code is ${code}. Valid for 10 minutes. Do not share this code.`;

  if (channel === "email") {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn(`[otp][mock] email to ${identifier}: ${message}`);
      return { mock: true };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.OTP_EMAIL_FROM || "SSL <onboarding@ssl.mtkcodex.site>",
        to: identifier,
        subject: "Your SSL verification code",
        text: message,
      }),
    });
    if (!res.ok) throw new Error(`Resend error: ${res.status}`);
    return { mock: false };
  }

  if (channel === "sms") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
      console.warn(`[otp][mock] sms to ${identifier}: ${message}`);
      return { mock: true };
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: identifier, From: from, Body: message }),
    });
    if (!res.ok) throw new Error(`Twilio error: ${res.status}`);
    return { mock: false };
  }

  // whatsapp
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.warn(`[otp][mock] whatsapp to ${identifier}: ${message}`);
    return { mock: true };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: identifier.replace(/^\+/, ""),
      type: "text",
      text: { body: message },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp error: ${res.status}`);
  return { mock: false };
}
