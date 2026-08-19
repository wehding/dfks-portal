import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { applyAgreementRoyalty, type AgreementRoyaltyRule } from "@/lib/agreement-royalty";

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

export async function getApprovedAgreementRoyaltyRules(): Promise<AgreementRoyaltyRule[]> {
  const db = createServiceClient();
  const { data: rows, error } = await db
    .from("agreement_percentage_rules")
    .select("id,percent,basis,production_type,section_reference,valid_from,valid_to,status,agreements!inner(code,title,status)")
    .eq("label_key", "royalty")
    .in("status", ["approved", "archived"])
    .in("agreements.status", ["approved", "archived"]);

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

export async function applyApprovedAgreementRoyalty(data: Record<string, unknown>) {
  return applyAgreementRoyalty(data, await getApprovedAgreementRoyaltyRules());
}
