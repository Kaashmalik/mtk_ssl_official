"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report every uncaught route error to Sentry. The `digest` is Next.js'
    // stable identifier for the error — including it lets us correlate
    // server and client halves of the same error.
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "route-error-boundary" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "50vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        Something went wrong!
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "#a1a1aa",
          marginBottom: 24,
          maxWidth: 320,
        }}
      >
        An error occurred while loading this page. Our team has been notified.
      </p>
      <button
        onClick={() => reset()}
        style={{
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          backgroundColor: "#059669",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
