"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Global error boundary — catches errors that escape the root layout.
    // These are the most severe (whole-page failures), so mark them fatal.
    Sentry.captureException(error, {
      level: "fatal",
      tags: { source: "global-error-boundary" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html>
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", padding: "0 16px" }}>
          <div
            style={{
              fontSize: 48,
              marginBottom: 16,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong!
          </h1>
          <p style={{ fontSize: 14, color: "#a1a1aa", marginBottom: 24 }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={() => reset()}
            style={{
              width: "100%",
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
      </body>
    </html>
  );
}
