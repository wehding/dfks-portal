import { NextRequest, NextResponse, after } from "next/server";
import { validateContractImportFile } from "@/lib/contract-import";
import { intakeContractFile } from "@/lib/server/contract-import-intake";
import { processPendingContractJobs } from "@/lib/server/contract-import-processor";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { requireContractImportWriteAccess } from "@/lib/server/contract-import-access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const auth = await requireContractImportWriteAccess();
  if (!auth) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { caller } = auth;
  const { batchId } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");
  const clientToken = String(formData.get("clientToken") ?? "");
  const effectiveRightsHolderId = auth.canManageOwnership
    ? String(formData.get("rightsHolderId") ?? "") || null
    : null;
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
    rightsHolderId: effectiveRightsHolderId,
    workId: requestedWorkId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "import", component: "admin.contract-imports.item-upload", entityType: "contract_import_batches", entityId: batchId, targetMemberUuid: effectiveRightsHolderId, orgIds: [caller.orgId], purposeCode: "contract_import", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["contract_data", "document_data", "union_membership_data"], counts: { duplicate: result.duplicate } });
  after(async () => { await processPendingContractJobs(caller.orgId); });
  return NextResponse.json({ item: result.item, duplicate: result.duplicate });
}
