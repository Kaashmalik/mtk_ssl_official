import { z } from "zod";

export class APIError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = "APIError";
  }
}

function getErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean>;
}

export async function apiClient<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  options: FetchOptions = {}
): Promise<T> {
  let url = `/api/v1${endpoint}`;
  
  if (options.params) {
    const searchParams = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new APIError(
      response.status,
      getErrorMessage(errorData, "An error occurred"),
      errorData
    );
  }

  const data = await response.json();
  
  // Validate the response data with Zod
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error("API Validation Error:", result.error);
    throw new APIError(500, "Invalid response data format", result.error);
  }

  return result.data;
}
