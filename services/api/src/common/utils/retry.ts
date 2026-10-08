export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    attempts: number;
    baseDelayMs: number;
  }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) break;

      const jitter = Math.floor(Math.random() * options.baseDelayMs);
      const delay = options.baseDelayMs * attempt + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}