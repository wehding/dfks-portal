import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv, getSupabaseServiceKey } from "@/lib/env";

export function createServiceClient() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getSupabaseServiceKey();
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
