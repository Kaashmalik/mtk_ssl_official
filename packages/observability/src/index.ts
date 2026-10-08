// Structured JSON logger (Edge + Node compatible)
export {
  logger,
  Logger,
  setLogLevel,
  type LogLevel,
  type LogContext,
} from "./logger";

// Sentry wrapper (optional peer dep, falls back to logger)
export {
  captureError,
  captureMessage,
  flush,
  type CaptureOptions,
} from "./sentry";

// Request-scoped context (requestId propagation via AsyncLocalStorage)
export {
  resolveRequestId,
  withRequestContext,
  getRequestContext,
  getRequestLogger,
  type RequestContext,
} from "./request-context";

// Health-check primitives
export {
  HealthRegistry,
  rollupStatus,
  pingPostgres,
  pingRedis,
  type Probe,
  type ProbeResult,
  type HealthStatus,
} from "./health";

// HTTP helpers for health endpoints
export {
  statusForHealth,
  healthResponse,
  jsonResponse,
  type HealthResponse,
} from "./http";
