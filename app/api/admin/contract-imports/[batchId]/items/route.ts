import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { validateContractImportFile } from "@/lib/contract-import";
import { intakeContractFile } from "@/lib/server/contract-import-intake";
import { processPendingContractJobs } from "@/lib/server/contract-import-processor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { batchId } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");
  const clientToken = String(formData.get("clientToken") ?? "");
  const preferredRightsHolderId = String(formData.get("rightsHolderId") ?? "") || null;
  const requestedWorkId = String(formData.get("workId") ?? "") || null;
  if (!(file instanceof File)) return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 });
  const validationError = validateContractImportFile(file);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(clientToken)) return NextResponse.json({ error: "Ugyldig filreference" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await intakeContractFile({
    batchId,
    actor: caller,
    file: { name: file.name, contentType: file.type, buffer, clientToken },
    rightsHolderId: preferredRightsHolderId,
    workId: requestedWorkId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  after(async () => { await processPendingContractJobs(caller.orgId); });
  return NextResponse.json({ item: result.item, duplicate: result.duplicate });
}
