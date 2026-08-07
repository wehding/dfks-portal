import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20));
  const db = createServiceClient();
  const { data, error } = await db.from("contract_import_batches")
    .select("id,source,status,discovered_count,uploaded_count,duplicate_count,completed_count,failed_count,created_at,updated_at")
    .eq("org_id", caller.orgId).order("created_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: "Importhistorikken kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ batches: data ?? [] });
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { source?: string; discoveredCount?: number };
  const source = body.source === "google_drive" || body.source === "onedrive" || body.source === "dropbox" ? body.source : "computer";
  const discoveredCount = Math.max(0, Math.floor(Number(body.discoveredCount) || 0));
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data, error } = await db.from("contract_import_batches").insert({
    org_id: caller.orgId,
    created_by: caller.userId,
    source,
    status: "receiving",
    discovered_count: discoveredCount,
  }).select("id,status,created_at").single();
  if (error || !data) return NextResponse.json({ error: "Importbatch kunne ikke oprettes" }, { status: 500 });
  return NextResponse.json({ batch: data });
}

