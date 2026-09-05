import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { applyAgreementWage, wageRulesToSatser, type AgreementWageRule } from "@/lib/agreement-wage";

type WageRuleRow = {
  id: string;
  profession_role: string;
  wage_group: string | null;
  employment_form: AgreementWageRule["employmentForm"];
  rate_kind: string;
  amount: number | string;
  currency: string;
  unit: string;
  pension_included: boolean;
  valid_from: string;
  valid_to: string | null;
  source_title: string | null;
  source_url: string | null;
  source_section: string | null;
  source_note: string | null;
  status: AgreementWageRule["status"];
  agreements: {
    code: string;
    title: string;
    status: AgreementWageRule["agreementStatus"];
    production_types: string[];
    profession_roles: string[];
  } | Array<{
    code: string;
    title: string;
    status: AgreementWageRule["agreementStatus"];
    production_types: string[];
    profession_roles: string[];
  }>;
};

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

export async function getApprovedAgreementWageRules(agreementCode?: string): Promise<AgreementWageRule[]> {
  const db = createServiceClient();
  let query = db
    .from("agreement_wage_rules")
    .select("id,profession_role,wage_group,employment_form,rate_kind,amount,currency,unit,pension_included,valid_from,valid_to,source_title,source_url,source_section,source_note,status,agreements!inner(code,title,status,production_types,profession_roles)")
    .in("status", ["approved", "archived"])
    .in("agreements.status", ["approved", "archived"]);

  if (agreementCode) {
    query = query.eq("agreements.code", agreementCode);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.warn("[agreement-wage] Kunne ikke hente lønsatsregler:", error.message);
    return [];
  }

  return ((rows ?? []) as unknown as WageRuleRow[]).flatMap(row => {
    const agreement = relation(row.agreements);
    if (!agreement?.code) return [];
    return [{
      id: row.id,
      agreementCode: agreement.code,
      agreementTitle: agreement.title,
      agreementStatus: agreement.status,
      productionTypes: agreement.production_types ?? [],
      professionRoles: agreement.profession_roles ?? [],
      professionRole: row.profession_role,
      wageGroup: row.wage_group ?? null,
      employmentForm: row.employment_form,
      rateKind: row.rate_kind,
      amount: Number(row.amount),
      currency: row.currency,
      unit: row.unit,
      pensionIncluded: row.pension_included,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      sourceSection: row.source_section,
      sourceNote: row.source_note,
      status: row.status,
    } satisfies AgreementWageRule];
  });
}

export async function applyApprovedAgreementWage(data: Record<string, unknown>) {
  const agreementCode = String(data.pensionAgreementCode ?? data.agreementCode ?? "");
  const rules = await getApprovedAgreementWageRules(agreementCode || undefined);
  return applyAgreementWage(data, rules);
}

/**
 * Henter alle godkendte løn- og pensionssatser for én overenskomst (via agreements.code)
 * og returnerer dem i { beskrivelse, vaerdi, enhed }[]-formatet — til brug som tekstkontekst
 * i AI-systempromt (bruges af byggAbsolutteRegler() i lib/analyse.ts).
 */
export async function getAgreementSatserForContext(
  agreementCode: string,
): Promise<Array<{ beskrivelse: string; vaerdi: number; enhed: string }>> {
  const db = createServiceClient();

  const [wageRules, { data: pensionRows }, { data: pctRows }] = await Promise.all([
    getApprovedAgreementWageRules(agreementCode),
    db
      .from("agreement_pension_rules")
      .select("employer_percent,employee_percent,basis,section_reference,employment_form,agreements!inner(code)")
      .in("status", ["approved", "archived"])
      .eq("agreements.code", agreementCode),
    db
      .from("agreement_percentage_rules")
      .select("label,label_key,percent,basis,trigger_condition,category,section_reference,source_note,source_url,agreements!inner(code)")
      .in("status", ["approved", "archived"])
      .eq("agreements.code", agreementCode)
      .order("category")
      .order("label"),
  ]);

  const satser = wageRulesToSatser(wageRules);

  // Pensionssatser — inkludér grundlag (basis) og paragrafhenvisning, så
  // AI-prompten kan ræsonnere om hvad pensionen beregnes af (fx normalløn).
  const seen = new Set<string>();
  for (const row of pensionRows ?? []) {
    const key = `${row.employment_form}-${row.basis}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = row.section_reference ? ` (${row.section_reference})` : "";
    satser.push({
      beskrivelse: `pension${ref} — grundlag: ${row.basis}`,
      vaerdi: Number(row.employer_percent),
      enhed: `% af ${row.basis}`,
    });
    if (Number(row.employee_percent) > 0) {
      satser.push({
        beskrivelse: `pension (medarbejder)${ref} — grundlag: ${row.basis}`,
        vaerdi: Number(row.employee_percent),
        enhed: `% af ${row.basis}`,
      });
    }
  }

  // Procentbaserede tillæg og bidrag
  // label_key-map — garanterer at byggAbsolutteRegler()'s nøgleord altid er til stede
  const labelKeyPrefix: Record<string, string> = {
    beta_pulje: "beta",
    helligdagsbetaling: "helligdag",
    feriepenge: "feriepenge",
  };
  for (const row of pctRows ?? []) {
    const prefix = row.label_key ? `${labelKeyPrefix[row.label_key]}: ` : "";
    const source = row.source_url ? ` Kilde: ${row.source_url}.` : "";
    const note = row.source_note ? ` Fortolkning: ${row.source_note}` : "";
    satser.push({
      beskrivelse: `${prefix}${row.label}${row.section_reference ? ` (${row.section_reference})` : ""} — gælder ved: ${row.trigger_condition}${source}${note}`,
      vaerdi: Number(row.percent),
      enhed: `% af ${row.basis}`,
    });
  }

  return satser;
}
