import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { applyAgreementRoyalty, type AgreementRoyaltyRule } from "@/lib/agreement-royalty";
import { classifyToShortCode } from "@/lib/agreement-pension";
import { resolveAgreementByDate } from "@/lib/agreement-version-resolver";

type RoyaltyRuleRow = {
  id: string;
  percent: number | string;
  basis: string;
  production_type: string | null;
  section_reference: string | null;
  valid_from: string;
  valid_to: string | null;
  status: AgreementRoyaltyRule["status"];
  agreements: {
    code: string;
    title: string;
    status: AgreementRoyaltyRule["agreementStatus"];
  } | Array<{
    code: string;
    title: string;
    status: AgreementRoyaltyRule["agreementStatus"];
  }>;
};

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

export async function getApprovedAgreementRoyaltyRules(agreementId?: string | null): Promise<AgreementRoyaltyRule[]> {
  const db = createServiceClient();
  let query = db
    .from("agreement_percentage_rules")
    .select("id,percent,basis,production_type,section_reference,valid_from,valid_to,status,agreements!inner(code,title,status)")
    .eq("label_key", "royalty")
    .in("status", ["approved", "archived"])
    .in("agreements.status", ["approved", "archived"]);

  if (agreementId) {
    query = query.eq("agreement_id", agreementId);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.warn("[agreement-royalty] Kunne ikke hente royaltyregler:", error.message);
    return [];
  }

  return ((rows ?? []) as unknown as RoyaltyRuleRow[]).flatMap(row => {
    const agreement = relation(row.agreements);
    if (!agreement?.code) return [];
    return [{
      id: row.id,
      agreementCode: agreement.code,
      agreementTitle: agreement.title,
      agreementStatus: agreement.status,
      productionType: row.production_type,
      percent: Number(row.percent),
      basis: row.basis,
      sectionReference: row.section_reference,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status,
    } satisfies AgreementRoyaltyRule];
  });
}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export async function applyApprovedAgreementRoyalty(data: Record<string, unknown>) {
  const shortCode = classifyToShortCode(data);
  const contractDate = dateOnly(data.startDate) ?? dateOnly(data.contractDate);

  let agreementId: string | null = null;
  let resolvedCode: string | null = null;

  if (shortCode) {
    const version = await resolveAgreementByDate(shortCode, contractDate);
    if (version.found) {
      agreementId = version.id;
      resolvedCode = version.code;
    }
  }

  const rules = await getApprovedAgreementRoyaltyRules(agreementId);
  return applyAgreementRoyalty(
    resolvedCode ? { ...data, _resolvedAgreementCode: resolvedCode } : data,
    rules,
  );
}
