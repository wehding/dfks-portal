import "server-only";

import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

type BucketEntry = { count: number; resetAt: number };

const globalStore = globalThis as typeof globalThis & {
  __dfksRateLimits?: Map<string, BucketEntry>;
};

const store = globalStore.__dfksRateLimits ?? new Map<string, BucketEntry>();
globalStore.__dfksRateLimits = store;

export function requestIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(raw).digest("hex");
}

export function checkServerRateLimit(params: {
  bucket: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${params.bucket}:${params.identifier}`;
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + params.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= params.limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function consumeRateLimit(params: {
  bucket: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  try {
    const { data, error } = await createServiceClient().rpc("consume_api_rate_limit", {
      p_bucket: params.bucket,
      p_identifier_hash: params.identifier,
      p_limit: params.limit,
      p_window_seconds: Math.max(1, Math.ceil(params.windowMs / 1000)),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") throw new Error("invalid rate-limit response");
    return {
      allowed: row.allowed,
      retryAfterSeconds: Number(row.retry_after_seconds) || 0,
    };
  } catch (error) {
    // Local development before migrations and short database incidents still
    // get a best-effort limit. No request identifiers or database details are
    // logged.
    console.error("[rate-limit] persistent limiter unavailable", error instanceof Error ? error.name : "unknown");
    return checkServerRateLimit(params);
  }
}
