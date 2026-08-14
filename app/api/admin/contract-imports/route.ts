import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export const dynamic = "force-dynamic";

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20));
  const cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  const db = createServiceClient();
  let query = db.from("contract_import_batches")
    .select("id,source,status,discovered_count,uploaded_count,duplicate_count,completed_count,failed_count,created_at,updated_at")
    .eq("org_id", caller.orgId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Importhistorikken kunne ikke hentes" }, { status: 500 });
  const rows = data ?? [];
  const batches = rows.slice(0, limit);
  const last = batches.at(-1);
  const nextCursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url")
    : null;
  return NextResponse.json({ batches, nextCursor });
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { source?: string; discoveredCount?: number };
  const allowedSources = new Set(["computer", "google_drive", "onedrive", "dropbox", "gmail", "api"]);
  const source = typeof body.source === "string" && allowedSources.has(body.source) ? body.source : "computer";
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
