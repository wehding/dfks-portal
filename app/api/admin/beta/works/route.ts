import { NextRequest, NextResponse } from "next/server";
import { GLOBAL_ROLES } from "@/lib/admin-roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export async function PATCH(request: NextRequest) {
  const caller = await assertAdminRole(await createClient(), GLOBAL_ROLES);
  if (!caller) return NextResponse.json({ error: "Kun superadmin kan markere testværker." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const workIds = Array.isArray(body.workIds) ? body.workIds.filter((id: unknown) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500) : [];
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !workIds.length || typeof body.isTestData !== "boolean") return NextResponse.json({ error: "Ugyldig markering." }, { status: 400 });
  const db = createServiceClient();
  const { data: org } = await db.from("organisations").select("beta_test_mode").eq("id", orgId).maybeSingle();
  if (!org?.beta_test_mode) return NextResponse.json({ error: "Organisationen er ikke markeret som betatest." }, { status: 409 });
  const { data, error } = await db.from("works").update({ is_test_data: body.isTestData, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).in("id", workIds).select("id,title,is_test_data");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ updated: data?.length ?? 0, works: data ?? [] });
}
