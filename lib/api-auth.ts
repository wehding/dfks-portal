import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole, ADMIN_ROLES } from "@/lib/supabase/assert-admin";

type ApiAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

type ApiAdminResult =
  | { ok: true; userId: string; orgId: string; role: string }
  | { ok: false; response: NextResponse };

export async function requireSessionApi(): Promise<ApiAuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 }) };
  }
  return { ok: true, userId: user.id };
}

export async function requireAdminApi(roles: readonly string[] = ADMIN_ROLES): Promise<ApiAdminResult> {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, roles);
  if (!caller) {
    return { ok: false, response: NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 }) };
  }
  return { ok: true, userId: caller.userId, orgId: caller.orgId, role: caller.role };
}

export async function requireCronOrAdminApi(
  req: NextRequest,
  roles: readonly string[] = ADMIN_ROLES
): Promise<ApiAdminResult | { ok: true; isCron: true }> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return { ok: true, isCron: true };
  return requireAdminApi(roles);
}

export function requireInternalSecretApi(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const allowed = [process.env.INTERNAL_API_SECRET, process.env.CONTRACT_AI_JOB_SECRET, process.env.CRON_SECRET].filter(Boolean);
  return Boolean(bearer && allowed.includes(bearer));
}
