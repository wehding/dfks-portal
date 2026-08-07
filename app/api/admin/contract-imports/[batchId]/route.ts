import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { batchId } = await context.params;
  const db = createServiceClient();
  const [batchResult, itemResult] = await Promise.all([
    db.from("contract_import_batches").select("id,source,status,discovered_count,uploaded_count,duplicate_count,completed_count,failed_count,created_at,updated_at").eq("id", batchId).eq("org_id", caller.orgId).maybeSingle(),
    db.from("contract_import_items").select("id,client_token,original_file_name,status,contract_id,owner_match_score,work_match_score,error_code,error_message,updated_at").eq("batch_id", batchId).eq("org_id", caller.orgId).order("created_at"),
  ]);
  if (!batchResult.data) return NextResponse.json({ error: "Importbatch blev ikke fundet" }, { status: 404 });
  return NextResponse.json({ batch: batchResult.data, items: itemResult.data ?? [] });
}

