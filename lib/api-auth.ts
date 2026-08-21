import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { readActiveOrgId } from "@/lib/active-org-context";
import type { StaffModule, StaffOperation } from "@/lib/staff-access";
import { resolveAppAccessContext } from "@/lib/app-access-context";

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

export async function requireAdminApi(roles: readonly string[] = USER_ADMIN_ROLES): Promise<ApiAdminResult> {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, roles);
  if (!caller) {
    return { ok: false, response: NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 }) };
  }
  return { ok: true, userId: caller.userId, orgId: caller.orgId, role: caller.role };
}

export async function requireStaffModuleApi(
  module: StaffModule,
  operation: StaffOperation,
): Promise<ApiAdminResult & { global?: boolean; allowedOrgIds?: string[] }> {
  const supabase = await createClient();
  const access = await resolveAppAccessContext(supabase, await readActiveOrgId());
  if (!access?.canUseAdmin || !access.role || !access.modules?.[module][operation]) {
    return { ok: false, response: NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 }) };
  }
  return {
    ok: true,
    userId: access.userId,
    orgId: access.orgId,
    role: access.role,
    global: access.global,
    allowedOrgIds: access.allowedOrgIds,
  };
}

export async function requireCronOrAdminApi(
  req: NextRequest,
  roles: readonly string[] = USER_ADMIN_ROLES
): Promise<ApiAdminResult | { ok: true; isCron: true }> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return { ok: true, isCron: true };
  return requireAdminApi(roles);
}

export type InternalApiScope = "contract-ai" | "contract-review" | "drive-import" | "onboarding-import";

function internalSecretForScope(scope: InternalApiScope): string | null {
  const scoped = {
    "contract-ai": process.env.CONTRACT_AI_JOB_SECRET,
    "contract-review": process.env.CONTRACT_REVIEW_JOB_SECRET,
    "drive-import": process.env.DRIVE_IMPORT_JOB_SECRET,
    "onboarding-import": process.env.ONBOARDING_IMPORT_JOB_SECRET,
  }[scope];
  if (scoped) return scoped;

  // Det fælles legacy-secret accepteres kun lokalt, så eksisterende lokale
  // miljøer kan migreres uden at give ét produktionssecret adgang til alle jobs.
  return process.env.NODE_ENV === "production" ? null : process.env.INTERNAL_API_SECRET ?? null;
}

export function requireInternalSecretApi(req: NextRequest, scope: InternalApiScope): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const expected = internalSecretForScope(scope);
  return Boolean(bearer && expected && bearer === expected);
}

export function getInternalWorkerSecret(scope: InternalApiScope): string | null {
  return internalSecretForScope(scope);
}

export function isInternalWorkerSecret(secret: string | null | undefined, scope: InternalApiScope): boolean {
  const expected = internalSecretForScope(scope);
  return Boolean(secret && expected && secret === expected);
}
