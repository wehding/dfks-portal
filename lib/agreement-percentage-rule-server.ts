import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { applyPercentageRule, type ApprovedPercentageRule, type PercentageRuleResolution } from "@/lib/agreement-percentage-rule";
import { classifyToShortCode } from "@/lib/agreement-pension";
import { resolveAgreementByDate } from "@/lib/agreement-version-resolver";

type RuleRow = {
  id: string;
  label_key: string;
  label: string;
  percent: number | string;
  basis: string;
  production_type: string | null;
  trigger_condition: string | null;
  section_reference: string | null;
  valid_from: string;
  valid_to: string | null;
  status: ApprovedPercentageRule["status"];
  agreements: {
    code: string;
    title: string;
    status: ApprovedPercentageRule["agreementStatus"];
  } | Array<{
    code: string;
    title: string;
    status: ApprovedPercentageRule["agreementStatus"];
  }>;
};

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

async function getRules(labelKey: string, agreementId?: string | null): Promise<ApprovedPercentageRule[]> {
  const db = createServiceClient();
  let query = db
    .from("agreement_percentage_rules")
    .select("id,label_key,label,percent,basis,production_type,trigger_condition,section_reference,valid_from,valid_to,status,agreements!inner(code,title,status)")
    .eq("label_key", labelKey)
    .in("status", ["approved", "archived"])
    .in("agreements.status", ["approved", "archived"]);

  if (agreementId) query = query.eq("agreement_id", agreementId);

  const { data: rows, error } = await query;
  if (error) {
    console.warn(`[agreement-percentage-rule] Kunne ikke hente regler for ${labelKey}:`, error.message);
    return [];
  }

  return ((rows ?? []) as unknown as RuleRow[]).flatMap(row => {
    const agr = relation(row.agreements);
    if (!agr?.code) return [];
    return [{
      id: row.id,
      agreementCode: agr.code,
      agreementTitle: agr.title,
      agreementStatus: agr.status,
      labelKey: row.label_key,
      label: row.label,
      percent: Number(row.percent),
      basis: row.basis,
      productionType: row.production_type,
      triggerCondition: row.trigger_condition,
      sectionReference: row.section_reference,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status,
    } satisfies ApprovedPercentageRule];
  });
}

async function applyRule(
  data: Record<string, unknown>,
  labelKey: string,
  contractField: string,
  outputPrefix: string,
  label: string,
): Promise<PercentageRuleResolution> {
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

  const rules = await getRules(labelKey, agreementId);
  return applyPercentageRule(
    resolvedCode ? { ...data, _resolvedAgreementCode: resolvedCode } : data,
    rules,
    { labelKey, contractField, outputPrefix, label },
  );
}

export function applyApprovedHolidayPay(data: Record<string, unknown>) {
  return applyRule(data, "helligdagsbetaling", "holidayPayRate", "holidayPay", "Helligdagsbetaling");
}

export function applyApprovedBetaContribution(data: Record<string, unknown>) {
  return applyRule(data, "beta_pulje", "betaRate", "beta", "BETA-fond");
}

export function applyApprovedSvod(data: Record<string, unknown>) {
  return applyRule(data, "svod", "svodRate", "svod", "SVOD-tillæg");
}

export function applyApprovedCopydan(data: Record<string, unknown>) {
  return applyRule(data, "copydan", "copydanRate", "copydan", "Copydan");
}
