import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(_: Request, context: { params: Promise<{ contractId: string }> }) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (!holder) return NextResponse.json({ error: "Rettighedshaverprofilen blev ikke fundet" }, { status: 404 });
  const { contractId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) return NextResponse.json({ error: "Ugyldig kontrakt" }, { status: 400 });

  let currentId = contractId;
  for (let i = 0; i < 100; i += 1) {
    const next = await db.from("contracts").select("superseded_by_contract_id").eq("id", currentId).eq("rights_holder_id", holder.id).maybeSingle();
    if (!next.data) return NextResponse.json({ error: "Kontrakten blev ikke fundet" }, { status: 404 });
    if (!next.data.superseded_by_contract_id) break;
    currentId = next.data.superseded_by_contract_id;
  }
  const versions: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 100; i += 1) {
    const row = await db.from("contracts")
      .select("id,working_title,contract_date,created_at,pdf_url,processed_pdf_url,superseded_at")
      .eq("id", currentId).eq("rights_holder_id", holder.id).maybeSingle();
    if (!row.data) break;
    versions.push({ ...row.data, isCurrent: i === 0 });
    const previous = await db.from("contracts").select("id")
      .eq("superseded_by_contract_id", currentId).eq("rights_holder_id", holder.id).maybeSingle();
    if (!previous.data) break;
    currentId = previous.data.id;
  }
  return NextResponse.json({ versions }, { headers: { "Cache-Control": "no-store" } });
}
