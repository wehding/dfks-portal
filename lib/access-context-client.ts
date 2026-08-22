type AccessContextResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};

const CACHE_TTL_MS = 5_000;

let cached: { expiresAt: number; result: AccessContextResult<unknown> } | null = null;
let inFlight: Promise<AccessContextResult<unknown>> | null = null;

export function invalidateAccessContextCache() {
  cached = null;
  inFlight = null;
}

export async function getAccessContextCached<T>(): Promise<AccessContextResult<T>> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result as AccessContextResult<T>;
  }
  if (inFlight) return inFlight as Promise<AccessContextResult<T>>;

  inFlight = fetch("/api/access/context", { cache: "no-store" })
    .then(async response => {
      const result: AccessContextResult<unknown> = {
        ok: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null,
      };
      if (response.ok) cached = { expiresAt: Date.now() + CACHE_TTL_MS, result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight as Promise<AccessContextResult<T>>;
}
