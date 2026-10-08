/**
 * Ambient fallback types for `@sentry/nextjs`.
 *
 * This file lets `@mtk/observability` compile in workspaces that haven't
 * installed Sentry (it's an optional peer dependency). When the real package
 * IS present in `node_modules`, TypeScript prefers the real types over this
 * shim because real `node_modules/@sentry/nextjs` declarations have higher
 * resolution priority than an ambient module declaration.
 *
 * If you install @sentry/nextjs and still see these stubs winning, delete
 * this file — it exists only to keep `tsc` green for Sentry-less consumers.
 */

declare module "@sentry/nextjs" {
  export type SeverityLevel = "info" | "warning" | "error" | "fatal";
  export interface CaptureContext {
    level?: SeverityLevel;
    extra?: Record<string, unknown>;
    tags?: Record<string, string | number | boolean>;
  }
  export function init(options: Record<string, unknown>): void;
  export function captureException(error: unknown, context?: CaptureContext): string;
  export function captureMessage(message: string, context?: CaptureContext | SeverityLevel): string;
  export function flush(timeoutMs?: number): Promise<boolean>;
  const _default: {
    init: typeof init;
    captureException: typeof captureException;
    captureMessage: typeof captureMessage;
    flush: typeof flush;
  };
  export default _default;
}
