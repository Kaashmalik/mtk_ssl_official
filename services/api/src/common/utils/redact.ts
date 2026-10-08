const DEFAULT_REDACT_KEYS = new Set([
  "password",
  "passcode",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "apiKey",
  "secret",
  "clientSecret",
  "ssn",
  "email",
  "phone",
  "otp",
  "pin",
  "creditCard",
  "cardNumber",
]);

const REDACTED_VALUE = "[REDACTED]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

export function redactSensitiveData(
  input: unknown,
  keysToRedact: Set<string> = DEFAULT_REDACT_KEYS
): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item, keysToRedact));
  }

  if (isPlainObject(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if (keysToRedact.has(key)) {
          return [key, REDACTED_VALUE];
        }
        return [key, redactSensitiveData(value, keysToRedact)];
      })
    );
  }

  return input;
}

export function safeSerialize(input: unknown, maxBytes: number): string {
  try {
    const json = JSON.stringify(input);
    if (Buffer.byteLength(json, "utf8") <= maxBytes) {
      return json;
    }

    return json.slice(0, Math.max(0, maxBytes - 3)) + "...";
  } catch {
    return "[Unserializable]";
  }
}