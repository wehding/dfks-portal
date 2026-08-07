import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { syncImportSource } from "@/lib/server/import-source-sync";
import { processPendingContractJobs } from "@/app/api/contracts/jobs/process/route";

export async function POST(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const result = await syncImportSource((await context.params).sourceId, caller);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.imported) after(async () => { await processPendingContractJobs(caller.orgId); });
  return NextResponse.json(result);
}
