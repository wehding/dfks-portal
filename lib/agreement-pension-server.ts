import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { applyAgreementPension, classifyToShortCode, type AgreementPensionRule } from "@/lib/agreement-pension";
import { resolveAgreementByDate } from "@/lib/agreement-version-resolver";

type RuleRow = {
  id: string;
  employment_form: AgreementPensionRule["employmentForm"];
  employer_percent: number | string;
  employee_percent: number | string;
  basis: AgreementPensionRule["basis"];
  scheme_kind: AgreementPensionRule["schemeKind"];
  valid_from: string;
  valid_to: string | null;
  section_reference: string;
  source_note: string | null;
  status: AgreementPensionRule["status"];
  agreements: {
    code: string;
    title: string;
    status: AgreementPensionRule["agreementStatus"];
    source_url: string | null;
    production_types: string[];
    profession_roles: string[];
  } | Array<{
    code: string;
    title: string;
    status: AgreementPensionRule["agreementStatus"];
    source_url: string | null;
    production_types: string[];
    profession_roles: string[];
  }>;
};

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

export async function getApprovedAgreementPensionRules(agreementId?: string | null) {
  const db = createServiceClient();
  let query = db
    .from("agreement_pension_rules")
    .select("id,employment_form,employer_percent,employee_percent,basis,scheme_kind,valid_from,valid_to,section_reference,source_note,status,agreements!inner(code,title,status,source_url,production_types,profession_roles)")
    .in("status", ["approved", "archived"])
    .in("agreements.status", ["approved", "archived"]);

  if (agreementId) {
    query = query.eq("agreement_id", agreementId);
  }

  const { data: rows, error } = await query;

  if (error) {
    // Migrationen kan mangle i et lokalt miljø. AI-aflæsning skal stadig virke,
    // men må ikke gætte en pensionsregel uden registeret.
    console.warn("[agreement-pension] Kunne ikke hente pensionsregler:", error.message);
    return [];
  }

  return ((rows ?? []) as unknown as RuleRow[]).flatMap(row => {
    const agreement = relation(row.agreements);
    if (!agreement?.code) return [];
    return [{
      id: row.id,
      agreementCode: agreement.code,
      agreementTitle: agreement.title,
      agreementStatus: agreement.status,
      sourceUrl: agreement.source_url,
      productionTypes: agreement.production_types ?? [],
      professionRoles: agreement.profession_roles ?? [],
      employmentForm: row.employment_form,
      employerPercent: Number(row.employer_percent),
      employeePercent: Number(row.employee_percent),
      basis: row.basis,
      schemeKind: row.scheme_kind,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      sectionReference: row.section_reference,
      sourceNote: row.source_note,
      status: row.status,
    } satisfies AgreementPensionRule];
  });

}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export async function applyApprovedAgreementPension(data: Record<string, unknown>) {
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

  const rules = await getApprovedAgreementPensionRules(agreementId);
  return applyAgreementPension(
    resolvedCode ? { ...data, _resolvedAgreementCode: resolvedCode } : data,
    rules,
  );
}
