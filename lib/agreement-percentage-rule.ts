/**
 * Generisk deterministisk opslag i agreement_percentage_rules for ét label_key.
 * Bruges til helligdagsbetaling og BETA-fondsbidrag — samme arkitektur som
 * lib/agreement-royalty.ts. Eksplicit kontraktværdi vinder altid over
 * den deterministisk udledte overenskomstsats.
 */

export type PercentageRuleResolution = {
  data: Record<string, unknown>;
  applied: boolean;
  reason: string;
};

export type ApprovedPercentageRule = {
  id: string;
  agreementCode: string;
  agreementTitle: string;
  agreementStatus: "draft" | "approved" | "archived";
  labelKey: string;
  label: string;
  percent: number;
  basis: string;
  productionType: string | null;
  triggerCondition: string | null;
  sectionReference: string | null;
  validFrom: string;
  validTo: string | null;
  status: "draft" | "approved" | "archived";
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export function applyPercentageRule(
  input: Record<string, unknown>,
  rules: ApprovedPercentageRule[],
  opts: {
    labelKey: string;
    /** Feltnavn i extracted data som AI'en evt. har udfyldt */
    contractField: string;
    /** Præfiks for output-felter: fx "holidayPay" → holidayPayPercent, holidayPaySourceType osv. */
    outputPrefix: string;
    /** Menneskelig betegnelse til tags og logs */
    label: string;
  },
): PercentageRuleResolution {
  const { contractField, outputPrefix, label } = opts;

  // Eksplicit sats i kontrakten vinder
  const explicitPercent = finiteNumber(input[contractField]);
  if (explicitPercent != null) {
    return {
      applied: false,
      reason: "explicit_contract_term",
      data: {
        ...input,
        [`${outputPrefix}SourceType`]: "contract",
        [`${outputPrefix}Tag`]: `${label} ${explicitPercent.toLocaleString("da-DK")}% · kontraktvilkår`,
      },
    };
  }

  // _resolvedAgreementCode injiceres af server-wrapperen
  const resolvedCode = typeof input._resolvedAgreementCode === "string" ? input._resolvedAgreementCode : null;
  if (!resolvedCode) {
    return { applied: false, reason: "agreement_ambiguous", data: input };
  }

  const effectiveDate = dateOnly(input.startDate) ?? dateOnly(input.contractDate);
  const productionType = String(input.productionType ?? "");

  const candidates = rules.filter(r =>
    r.agreementStatus !== "draft"
    && r.status !== "draft"
    && (effectiveDate == null || (
      r.validFrom <= effectiveDate
      && (r.validTo == null || r.validTo >= effectiveDate)
    ))
  );

  if (!candidates.length) {
    return { applied: false, reason: "no_approved_rule", data: input };
  }

  const rule =
    candidates.find(r => r.productionType === productionType) ??
    candidates.find(r => r.productionType == null);

  if (!rule) {
    return { applied: false, reason: "no_matching_production_type", data: input };
  }

  return {
    applied: true,
    reason: "approved_agreement_rule",
    data: {
      ...input,
      [contractField]: rule.percent,
      [`${outputPrefix}SourceType`]: "collective_agreement",
      [`${outputPrefix}AgreementCode`]: rule.agreementCode,
      [`${outputPrefix}AgreementTitle`]: rule.agreementTitle,
      [`${outputPrefix}AgreementSection`]: rule.sectionReference,
      [`${outputPrefix}Tag`]: `${label} ${rule.percent.toLocaleString("da-DK")}% · via ${rule.agreementTitle}`,
      [`_${outputPrefix}Resolution`]: {
        appliedAt: new Date().toISOString(),
        ruleId: rule.id,
        effectiveDate,
        productionType,
        reason: "approved_agreement_rule",
      },
    },
  };
}
