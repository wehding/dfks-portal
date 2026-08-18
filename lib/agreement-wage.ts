export type AgreementWageRule = {
  id: string;
  agreementCode: string;
  agreementTitle: string;
  agreementStatus: "draft" | "approved" | "archived";
  productionTypes: string[];
  professionRoles: string[];
  professionRole: string;
  wageGroup: string | null;
  employmentForm: "a-løn" | "lønmodtager-freelance" | "leverandør";
  rateKind: string;
  amount: number;
  currency: string;
  unit: string;
  pensionIncluded: boolean;
  validFrom: string;
  validTo: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceSection: string | null;
  sourceNote: string | null;
  status: "draft" | "approved" | "archived";
};

export type WageStatus =
  | "explicit_contract"
  | "inferred_agreement"
  | "not_applicable"
  | "review_required"
  | "unknown";

type WageResolution = {
  data: Record<string, unknown>;
  applied: boolean;
  reason: string;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("da")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function roleMatches(rule: AgreementWageRule, value: unknown) {
  const role = normalized(value);
  if (!role) return false;
  return rule.professionRoles.some(item => {
    const candidate = normalized(item);
    return role === candidate || role.includes(candidate) || candidate.includes(role);
  });
}

function withWageMetadata(data: Record<string, unknown>, patch: Record<string, unknown>) {
  return { ...data, ...patch };
}

/**
 * Ren funktion (ingen I/O): matcher kontraktdata mod et sæt lønsatsregler og
 * returnerer den gældende minimalløn fra overenskomsten, hvis én kan identificeres.
 *
 * Spejler applyAgreementPension() fra lib/agreement-pension.ts.
 */
export function applyAgreementWage(
  input: Record<string, unknown>,
  rules: AgreementWageRule[],
): WageResolution {
  const supplierTypes = ["leverandør", "leverandor"];
  const isSupplier = supplierTypes.includes(normalized(input.contractType)) || input.isFreelanceContract === true;

  if (isSupplier) {
    return {
      applied: false,
      reason: "supplier_not_covered",
      data: withWageMetadata(input, { wageStatus: "not_applicable" }),
    };
  }

  const isTruthy = (v: unknown) => v === true || ["ja", "yes", "true", "fundet"].includes(normalized(v));
  if (!isTruthy(input.collectiveAgreement) && normalized(input.agreementReferenceStatus) !== "yes") {
    return { applied: false, reason: "agreement_not_explicit", data: withWageMetadata(input, { wageStatus: "unknown" }) };
  }

  const agreementCode = String(input.pensionAgreementCode ?? input.agreementCode ?? "");
  if (!agreementCode) {
    return {
      applied: false,
      reason: "agreement_ambiguous",
      data: withWageMetadata(input, { wageStatus: "review_required" }),
    };
  }

  const effectiveDate = dateOnly(input.startDate) ?? dateOnly(input.contractDate);
  const form = normalized(input.agreementEmploymentForm);
  const employmentForm: AgreementWageRule["employmentForm"] = form.includes("freelance")
    ? "lønmodtager-freelance"
    : "a-løn";
  const productionType = String(input.productionType ?? "");
  const creditedFunction = input.creditedFunction ?? input.role ?? input.professionType;

  if (!effectiveDate || !productionType || !creditedFunction) {
    return {
      applied: false,
      reason: "coverage_data_missing",
      data: withWageMetadata(input, { wageStatus: "review_required", wageAgreementCode: agreementCode }),
    };
  }

  const candidates = rules.filter(rule =>
    rule.agreementCode === agreementCode
    && rule.agreementStatus !== "draft"
    && rule.status !== "draft"
    && rule.employmentForm === employmentForm
    && rule.rateKind === "normalløn"
  );

  const rule = candidates.find(item =>
    item.validFrom <= effectiveDate
    && (!item.validTo || item.validTo >= effectiveDate)
    && item.productionTypes.includes(productionType)
    && roleMatches(item, creditedFunction)
  );

  if (!rule) {
    return {
      applied: false,
      reason: "no_approved_matching_rule",
      data: withWageMetadata(input, { wageStatus: "review_required", wageAgreementCode: agreementCode }),
    };
  }

  const contractWage = finiteNumber(input.weeklyWage ?? input.aftaltLoen);
  const belowMinimum = contractWage != null ? contractWage < rule.amount : null;

  return {
    applied: true,
    reason: "approved_agreement_rule",
    data: withWageMetadata(input, {
      wageStatus: "inferred_agreement",
      minimumWage: rule.amount,
      minimumWageCurrency: rule.currency,
      minimumWageUnit: rule.unit,
      minimumWageAgreementCode: rule.agreementCode,
      minimumWageAgreementTitle: rule.agreementTitle,
      minimumWageAgreementSection: rule.sourceSection,
      minimumWageBelowMinimum: belowMinimum,
      wageTag: `Normalløn ${rule.amount.toLocaleString("da-DK")} ${rule.currency}/${rule.unit} · via ${rule.agreementTitle}`,
    }),
  };
}

/**
 * Konverterer en liste af lønsatsregler for én overenskomst til
 * { beskrivelse, vaerdi, enhed }[]-formatet som bruges af byggAbsolutteRegler() i analyse.ts.
 */
export function wageRulesToSatser(
  rules: AgreementWageRule[],
): Array<{ beskrivelse: string; vaerdi: number; enhed: string }> {
  return rules
    .filter(r => r.status !== "draft")
    .map(r => ({
      beskrivelse: `${r.rateKind}: ${r.professionRole}${r.wageGroup ? ` (${r.wageGroup})` : ""}`,
      vaerdi: r.amount,
      enhed: `${r.currency}/${r.unit}`,
    }))
}
