import { NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requireStaffModuleApi("producers", "read");
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const [broadcasterResult, producerTypeResult] = await Promise.all([
    db.from("broadcasters").select("id,name,logo_path,content_type").order("name"),
    db.from("organisation_producer_types").select("display_order,producer_types(id,code,name,origin)").eq("org_id", auth.orgId).order("display_order"),
  ]);
  if (broadcasterResult.error || producerTypeResult.error) {
    return NextResponse.json({ error: "Redigeringsvalgene kunne ikke hentes" }, { status: 500 });
  }
  const producerTypes = (producerTypeResult.data ?? [])
    .map(row => Array.isArray(row.producer_types) ? row.producer_types[0] : row.producer_types)
    .filter(Boolean);
  return NextResponse.json({ broadcasters: broadcasterResult.data ?? [], producerTypes }, {
    headers: { "cache-control": "private, max-age=300" },
  });
}
