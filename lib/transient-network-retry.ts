export type RetryOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return [
    "failed to fetch",
    "fetch failed",
    "networkerror",
    "network request failed",
    "load failed",
    "connection closed",
    "connection reset",
  ].some(fragment => message.includes(fragment));
}

export async function retryTransientNetwork<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  const sleep = options.sleep ?? (delay => new Promise(resolve => setTimeout(resolve, delay)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientNetworkError(error)) throw error;
      await sleep(delayMs * attempt);
    }
  }

  throw new Error("Netværkskaldet kunne ikke gennemføres.");
}
