/**
 * Structured logger.
 *
 * Emits one JSON line per log call to stdout/stderr — parsable by any log
 * aggregator (Vercel, Datadog, Axiom, Loki, CloudWatch, …).
 *
 * Design goals:
 *   - Zero dependencies (works on Edge and Node runtimes).
 *   - Never throws: a logging failure must not crash the request.
 *   - Cheap when disabled: `debug`/`trace` no-op when LOG_LEVEL >= info.
 *   - Request-scoped context (requestId, userId, tenantId) injected via
 *     `logger.child()` so callers don't repeat themselves.
 *
 * Output shape (one JSON object per line):
 *   {
 *     "ts": "2026-06-20T12:34:56.789Z",
 *     "level": "info",
 *     "msg": "Tournament created",
 *     "requestId": "req_abc",
 *     "tenantId": "tenant-uuid",
 *     "userId": "user_123",
 *     "service": "web",
 *     "durationMs": 42,
 *     ...extra fields
 *   }
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function resolveMinLevel(): LogLevel {
  const raw = (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "info";
  const lvl = String(raw).toLowerCase() as LogLevel;
  return LEVEL_RANK[lvl] !== undefined ? lvl : "info";
}

let MIN_LEVEL: LogLevel = resolveMinLevel();

/** Allow runtime reconfiguration (e.g., tests, dynamic log levels). */
export function setLogLevel(level: LogLevel): void {
  MIN_LEVEL = level;
}

/** Context attached to every log line emitted by a logger instance. */
export interface LogContext {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  service?: string;
  /** Any additional structured fields. */
  [key: string]: unknown;
}

/** Safely serialise a value, falling back to a string if it throws. */
function safeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    // Error objects serialise to {} by default — expand them.
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause:
          value.cause instanceof Error
            ? safeJson(value.cause)
            : (value.cause as unknown),
      };
    }
    // Plain objects / arrays — round-trip to drop non-serialisable fields.
    return JSON.parse(JSON.stringify(value, replacer));
  } catch {
    return String(value);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
    };
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return undefined;
  if (typeof value === "symbol") return value.toString();
  return value;
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export class Logger {
  constructor(private readonly baseCtx: LogContext = {}) {}

  /** Returns a new logger with additional context merged in. */
  child(extra: LogContext): Logger {
    return new Logger({ ...this.baseCtx, ...extra });
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

    const record: Record<string, unknown> = {
      ts: nowIso(),
      level,
      msg,
      ...this.baseCtx,
      ...(fields ?? {}),
    };

    // Make sure every value is JSON-safe (errors, bigint, circular refs, …).
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      safe[k] = safeJson(v);
    }

    const line = JSON.stringify(safe);

    // Use the right stream. `console` is available on both Edge and Node.
    const sink = level === "error" || level === "fatal" ? console.error : console.log;
    try {
      sink(line);
    } catch {
      // Logging must NEVER throw. Swallow as a last resort.
    }
  }

  trace(msg: string, fields?: Record<string, unknown>): void {
    this.emit("trace", msg, fields);
  }
  debug(msg: string, fields?: Record<string, unknown>): void {
    this.emit("debug", msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", msg, fields);
  }
  error(msg: string, errorOrFields?: unknown, extra?: Record<string, unknown>): void {
    if (errorOrFields instanceof Error) {
      this.emit("error", msg, { error: errorOrFields, ...(extra ?? {}) });
    } else if (typeof errorOrFields === "object" && errorOrFields !== null) {
      this.emit("error", msg, { ...(errorOrFields as Record<string, unknown>), ...(extra ?? {}) });
    } else {
      this.emit("error", msg, extra);
    }
  }
  fatal(msg: string, errorOrFields?: unknown, extra?: Record<string, unknown>): void {
    if (errorOrFields instanceof Error) {
      this.emit("fatal", msg, { error: errorOrFields, ...(extra ?? {}) });
    } else if (typeof errorOrFields === "object" && errorOrFields !== null) {
      this.emit("fatal", msg, { ...(errorOrFields as Record<string, unknown>), ...(extra ?? {}) });
    } else {
      this.emit("fatal", msg, extra);
    }
  }
}

/**
 * Default process-wide logger. Prefer `logger.child({ requestId, ... })` at
 * the start of a request so each line is correlated.
 */
export const logger: Logger = new Logger({
  service: (typeof process !== "undefined" && process.env?.SERVICE_NAME) || "app",
});
