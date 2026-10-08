export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DB_CONFLICT"
  | "DB_BAD_REQUEST"
  | "INTERNAL_ERROR";

export function resolveErrorCode(status: number, postgresCode?: string): ErrorCode {
  if (postgresCode === "23505") return "DB_CONFLICT";
  if (postgresCode === "23503" || postgresCode === "22P02") return "DB_BAD_REQUEST";

  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return "INTERNAL_ERROR";
  }
}