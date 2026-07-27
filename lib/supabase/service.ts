import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv, getSupabaseServiceKey } from "@/lib/env";
import type { AuditContext } from "@/lib/audit-log";

export function createServiceClient(options: { audit?: AuditContext } = {}) {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getSupabaseServiceKey();
  const audit = options.audit;
  const headers = audit ? {
    "x-dfks-actor-id": audit.actorUserId ?? "",
    "x-dfks-actor-org-id": audit.actorOrgId ?? "",
    "x-dfks-actor-role": audit.actorRole ?? "",
    "x-dfks-audit-source": audit.source,
    "x-dfks-correlation-id": audit.correlationId ?? "",
  } : undefined;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: headers ? { headers } : undefined,
  });
}
