import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@mtk/database";

export async function POST(request: NextRequest) {
  try {
    const { email, name } = await request.json();

    if (!email || !name) {
      return NextResponse.json(
        { error: "Email and name are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Supabase renamed the client-safe key from "anon" to "publishable"; accept
    // either so a project seeded from the current Supabase dashboard works.
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

    if (!supabaseUrl || !supabaseKey) {
      const missing = [
        !supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null,
        !supabaseKey
          ? "NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
          : null,
      ].filter(Boolean);
      console.error(`[waitlist] Not configured. Missing: ${missing.join(", ")}`);
      return NextResponse.json(
        {
          error: "Waitlist is temporarily unavailable. Please try again later.",
          missing,
        },
        { status: 503 }
      );
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseKey);

    // Insert into waitlist table
    const { error } = await supabase
      .from("waitlist")
      .insert([
        {
          email,
          name,
        },
      ]);

    if (error) {
      console.error("Waitlist insert error:", error);
      
      // Check for duplicate key violation
      if (error.code === "23505" || error.message?.includes("duplicate key")) {
        return NextResponse.json(
          { error: "This email is already registered on our waitlist." },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: "Failed to join waitlist. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Thank you for joining! We'll be in touch soon.",
    });
  } catch (error) {
    console.error("Waitlist API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

