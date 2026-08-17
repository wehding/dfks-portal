import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { applyAgreementPension } from "@/lib/agreement-pension";
import { getApprovedAgreementPensionRules } from "@/lib/agreement-pension-server";
import { createServiceClient } from "@/lib/supabase/service";

type ValidationRow = {
  contract_id: string;
  extracted_data: Record<string, unknown> | null;
  contracts: {
    id: string;
    org_id: string;
    status: string;
    type: string;
    overenskomst: string | null;
    contract_date: string | null;
    start_date: string | null;
    working_title: string | null;
    employers: { name: string | null } | { name: string | null }[] | null;
  } | Array<{
    id: string;
    org_id: string;
    status: string;
    type: string;
    overenskomst: string | null;
    contract_date: string | null;
    start_date: string | null;
    working_title: string | null;
    employers: { name: string | null } | { name: string | null }[] | null;
  }>;
};

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mergedData(row: ValidationRow) {
  const contract = one(row.contracts);
  const employer = contract ? one(contract.employers) : null;
  return {
    ...(row.extracted_data ?? {}),
    contractType: row.extracted_data?.contractType ?? contract?.type,
    overenskomst: row.extracted_data?.overenskomst ?? contract?.overenskomst,
    contractDate: row.extracted_data?.contractDate ?? contract?.contract_date,
    startDate: row.extracted_data?.startDate ?? contract?.start_date,
    employerName: row.extracted_data?.employerName ?? employer?.name,
  };
}

async function loadCandidates(orgId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("contract_validations")
    .select("contract_id,extracted_data,contracts!inner(id,org_id,status,type,overenskomst,contract_date,start_date,working_title,employers(name))")
    .eq("org_id", orgId)
    .eq("contracts.status", "kladde")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ValidationRow[];
}

export async function GET() {
  const auth = await requireAdminApi(["superadmin", "jurist"]);
  if (!auth.ok) return auth.response;
  try {
    const [rows, rules] = await Promise.all([loadCandidates(auth.orgId), getApprovedAgreementPensionRules()]);
    const candidates = rows.flatMap(row => {
      const result = applyAgreementPension(mergedData(row), rules);
      if (!result.applied) return [];
      const contract = one(row.contracts);
      return [{
        contractId: row.contract_id,
        title: contract?.working_title || "Kontrakt uden titel",
        pensionTag: result.data.pensionTag,
        agreementTitle: result.data.pensionAgreementTitle,
      }];
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("[pension-preview] preview failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Forhåndsvisning fejlede" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(["superadmin", "jurist"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const requestedIds = Array.isArray(body.contractIds) ? body.contractIds.filter((id: unknown): id is string => typeof id === "string") : [];
  if (!requestedIds.length) return NextResponse.json({ error: "Vælg mindst én kontrakt" }, { status: 400 });
  try {
    const [rows, rules] = await Promise.all([loadCandidates(auth.orgId), getApprovedAgreementPensionRules()]);
    const db = createServiceClient({ audit: { actorUserId: auth.userId, actorOrgId: auth.orgId, actorRole: auth.role, source: "admin" } });
    let updated = 0;
    const skipped: string[] = [];
    for (const row of rows.filter(item => requestedIds.includes(item.contract_id))) {
      const locked = Array.isArray(row.extracted_data?._lockedFields) ? row.extracted_data._lockedFields : [];
      if (locked.some(key => typeof key === "string" && key.startsWith("pension"))) {
        skipped.push(row.contract_id);
        continue;
      }
      const result = applyAgreementPension(mergedData(row), rules);
      if (!result.applied) {
        skipped.push(row.contract_id);
        continue;
      }
      const { error } = await db.from("contract_validations").update({ extracted_data: result.data }).eq("contract_id", row.contract_id).eq("org_id", auth.orgId);
      if (error) throw new Error(error.message);
      updated++;
    }
    try {
      await recordAuditEvent({
        context: { actorUserId: auth.userId, actorOrgId: auth.orgId, actorRole: auth.role, source: "admin" },
        action: "update",
        entityType: "contract_validation_batch",
        entityLabel: "Pension fra godkendte overenskomster",
        metadata: { requested: requestedIds.length, updated, skipped: skipped.length },
      });
    } catch (auditError) {
      console.error("[pension-preview] Opdatering lykkedes, men auditlog fejlede", auditError);
    }
    return NextResponse.json({ ok: true, updated, skipped });
  } catch (error) {
    console.error("[pension-preview] update failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Opdateringen fejlede" }, { status: 500 });
  }
}
