import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "404 — Page Not Found",
  description: "The page you requested does not exist in the SSL Admin panel.",
  path: "/404",
});

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground gap-6">
      <div className="text-center space-y-3">
        <p className="text-8xl font-extrabold text-primary">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This page doesn&apos;t exist in the SSL Admin panel.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-primary/90 transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
