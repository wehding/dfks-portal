import type { SupabaseClient } from "@supabase/supabase-js";

export type RequestAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; error: string };

export function classifyRequestAuthFailure(error: { status?: number } | null): 401 | 503 {
  const status = error?.status;
  if (status === 429 || status === 0 || (typeof status === "number" && status >= 500)) return 503;
  if (error && typeof status !== "number") return 503;
  return 401;
}

export async function verifyRequestUser(db: SupabaseClient): Promise<RequestAuthResult> {
  const { data: { user }, error } = await db.auth.getUser();
  if (user) return { ok: true, userId: user.id };

  const status = classifyRequestAuthFailure(error);
  return {
    ok: false,
    status,
    error: status === 401 ? "Du er ikke logget ind" : "Login kunne ikke bekræftes. Prøv igen.",
  };
}
