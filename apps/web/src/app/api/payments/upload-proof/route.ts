/**
 * Receipt / Payment Proof Upload API
 *
 * Accepts a multipart form with a receipt image file, uploads it to
 * private Supabase Storage (bucket: payment-proofs), and returns a
 * time-limited signed URL for the subscription request form.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@mtk/database";
import { captureError } from "@mtk/observability";
import { featureReadiness } from "@/lib/env";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_NAME_LENGTH = 120;
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7; // 7 days for admin review

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    const { missing } = featureReadiness("paymentsUpload");
    await captureError(
      new Error(`Payment proof upload unavailable: missing ${missing.join(", ")}`),
      {
        level: "error",
        context: { service: "web" },
        tags: { source: "upload-proof", feature: "paymentsUpload" },
      },
    );
    return NextResponse.json(
      {
        error: "Receipt upload is temporarily unavailable.",
        detail: `Server is missing ${missing.join(", ")}.`,
        missing,
      },
      { status: 503 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed." },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5 MB." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const sniffed = sniffImageMime(uint8Array);
    if (!sniffed || sniffed !== file.type) {
      return NextResponse.json(
        { error: "File content does not match the declared image type." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient(supabaseUrl, serviceKey);

    const timestamp = Date.now();
    const safeName = file.name
      .replace(/[/\\]/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, MAX_NAME_LENGTH);
    const storagePath = `receipts/${userId}/${timestamp}_${safeName || "receipt"}`;

    const { error: uploadError } = await supabase.storage
      .from("payment-proofs")
      .upload(storagePath, uint8Array, {
        contentType: sniffed,
        upsert: false,
        cacheControl: "private, max-age=0",
      });

    if (uploadError) {
      console.error("[upload-proof] Supabase upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload receipt image" },
        { status: 500 },
      );
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

    if (signError || !signed?.signedUrl) {
      console.error("[upload-proof] Signed URL error:", signError);
      return NextResponse.json(
        { error: "Uploaded but failed to create access URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      url: signed.signedUrl,
      path: storagePath,
      expiresIn: SIGNED_URL_SECONDS,
    });
  } catch (error) {
    console.error("[upload-proof] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload payment proof" },
      { status: 500 },
    );
  }
}
