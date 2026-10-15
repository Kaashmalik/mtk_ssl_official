/**
 * Receipt / Payment Proof Upload API
 *
 * Accepts a multipart form with a receipt image file, uploads it to
 * private Supabase Storage (bucket: payment-proofs), and returns a
 * time-limited signed URL for the subscription request form. The stored
 * content type is decided by magic-byte sniffing (lib/payment-proof), not
 * the client-declared multipart type; filenames are sanitized before use.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createSupabaseServerClient } from "@mtk/database";
import { captureError } from "@mtk/observability";
import { featureReadiness } from "@/lib/env";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_PROOF_FILE_SIZE,
  MAX_PROOF_NAME_LENGTH,
  PROOF_BUCKET,
  PROOF_SIGNED_URL_SECONDS,
  paymentProofStoragePath,
  sanitizeReceiptName,
  sniffImageMime,
} from "@/lib/payment-proof";

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

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed." },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_PROOF_FILE_SIZE) {
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

    const storagePath = paymentProofStoragePath(
      userId,
      Date.now(),
      sanitizeReceiptName(file.name, MAX_PROOF_NAME_LENGTH),
    );

    const { error: uploadError } = await supabase.storage
      .from(PROOF_BUCKET)
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
      .from(PROOF_BUCKET)
      .createSignedUrl(storagePath, PROOF_SIGNED_URL_SECONDS);

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
      expiresIn: PROOF_SIGNED_URL_SECONDS,
    });
  } catch (error) {
    console.error("[upload-proof] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload payment proof" },
      { status: 500 }
    );
  }
}
