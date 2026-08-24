import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { ADMIN_ROLES } from "@/lib/admin-roles";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const caller = await assertAdminRole(await createClient(), ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(value => UUID_PATTERN.test(value)))]
    .slice(0, 100);
  if (!ids.length) return NextResponse.json({ data: [] });

  const { data, error } = await createServiceClient().rpc("get_contract_review_job_statuses", {
    target_org_id: caller.orgId,
    target_review_ids: ids,
  });
  if (error) return NextResponse.json({ error: "Analysestatus kunne ikke hentes." }, { status: 500 });
  return NextResponse.json({ data: data ?? [] }, { headers: { "cache-control": "no-store" } });
}
