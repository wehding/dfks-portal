import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

const uuid = /^[0-9a-f-]{36}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await assertAdminRole(await createClient(), ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { id: contractId } = await context.params;
  if (!uuid.test(contractId)) return NextResponse.json({ error: "Ugyldig kontrakt" }, { status: 400 });
  const db = createServiceClient();
  const start = await db.from("contracts").select("id,superseded_by_contract_id").eq("id", contractId).eq("org_id", caller.orgId).maybeSingle();
  if (!start.data) return NextResponse.json({ error: "Kontrakten blev ikke fundet" }, { status: 404 });

  let currentId = contractId;
  for (let i = 0; i < 100; i += 1) {
    const next = await db.from("contracts").select("superseded_by_contract_id").eq("id", currentId).eq("org_id", caller.orgId).maybeSingle();
    if (!next.data?.superseded_by_contract_id) break;
    currentId = next.data.superseded_by_contract_id;
  }
  const chain: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 100; i += 1) {
    const row = await db.from("contracts")
      .select("id,working_title,status,contract_date,created_at,pdf_url,processed_pdf_url,superseded_at,superseded_by_contract_id")
      .eq("id", currentId).eq("org_id", caller.orgId).maybeSingle();
    if (!row.data) break;
    chain.push(row.data);
    const previous = await db.from("contracts")
      .select("id").eq("superseded_by_contract_id", currentId).eq("org_id", caller.orgId).maybeSingle();
    if (!previous.data) break;
    currentId = previous.data.id;
  }
  return NextResponse.json({ currentContractId: chain[0]?.id ?? contractId, versions: chain }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const caller = await assertAdminRole(await createClient(), ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { id: previousContractId } = await context.params;
  const body = await request.json().catch(() => ({})) as { currentContractId?: unknown };
  const currentContractId = typeof body.currentContractId === "string" ? body.currentContractId : "";
  if (!uuid.test(previousContractId) || !uuid.test(currentContractId)) {
    return NextResponse.json({ error: "Vælg en gyldig tidligere og aktuel kontrakt" }, { status: 400 });
  }
  const db = createServiceClient({ audit: {
    actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role,
    source: "admin", correlationId: crypto.randomUUID(), mode: "summary",
  } });
  const rows = await db.from("contracts").select("id,work_id").eq("org_id", caller.orgId).in("id", [previousContractId, currentContractId]);
  if (rows.error || rows.data?.length !== 2) return NextResponse.json({ error: "Kontrakterne blev ikke fundet i organisationen" }, { status: 404 });
  const [first, second] = rows.data;
  if (!first.work_id || !second.work_id || first.work_id !== second.work_id) {
    return NextResponse.json({ error: "Begge kontrakter skal være knyttet til det samme værk" }, { status: 409 });
  }
  const linked = await db.rpc("link_contract_version", {
    p_previous_contract_id: previousContractId,
    p_current_contract_id: currentContractId,
    p_actor_user_id: caller.userId,
  });
  if (linked.error) return NextResponse.json({ error: "Kontrakterne kunne ikke forbindes som versioner. Kontrollér, at de ikke allerede indgår i en anden versionskæde." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
