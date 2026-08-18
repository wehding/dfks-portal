export type PensionStatus =
  | "explicit_contract"
  | "inferred_agreement"
  | "not_applicable"
  | "unknown"
  | "conflict"
  | "review_required";

export type AgreementPensionRule = {
  id: string;
  agreementCode: string;
  agreementTitle: string;
  agreementStatus: "draft" | "approved" | "archived";
  sourceUrl: string | null;
  productionTypes: string[];
  professionRoles: string[];
  employmentForm: "a-løn" | "lønmodtager-freelance";
  employerPercent: number;
  employeePercent: number;
  basis: "normalløn" | "minimumsløn" | "grundløn" | "alle-løndele" | "honorar";
  schemeKind: "occupational_pension" | "pension_savings";
  validFrom: string;
  validTo: string | null;
  sectionReference: string;
  sourceNote: string | null;
  status: "draft" | "approved" | "archived";
};

type PensionResolution = {
  data: Record<string, unknown>;
  applied: boolean;
  reason: string;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("da")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function isTruthy(value: unknown) {
  if (value === true) return true;
  return ["ja", "yes", "true", "fundet"].includes(normalized(value));
}

export function isSupplierContract(data: Record<string, unknown>) {
  return ["leverandør", "leverandor"].includes(normalized(data.contractType)) || data.isFreelanceContract === true;
}

export function agreementEmploymentForm(data: Record<string, unknown>): "a-løn" | "lønmodtager-freelance" | null {
  if (isSupplierContract(data)) return null;
  const form = normalized(data.agreementEmploymentForm);
  if (form.includes("freelance")) return "lønmodtager-freelance";
  return "a-løn";
}

export function identifyAgreementCode(data: Record<string, unknown>) {
  const raw = normalized([
    data.overenskomst,
    data.collectiveAgreementName,
    data.agreementName,
  ].filter(Boolean).join(" "));
  const productionType = normalized(data.productionType);
  const employmentForm = agreementEmploymentForm(data);
  const employer = normalized(data.employerName ?? data.producerName);

  if (/\bde ?4\b/.test(raw) || raw.includes("de4 fiktion")) return "de4-fiction-2022";
  if (raw.includes("metal")) return employer === "dr" || employer.includes("danmarks radio") ? "dr-metal-2025" : null;
  if (raw.includes("dj") && raw.includes("tv")) return "dj-tv-2024";
  if (raw === "dj" || raw.includes("journalistforbund")) return "dj-tv-2024";
  if (raw.includes("faf") && raw.includes("tv")) {
    return employmentForm === "lønmodtager-freelance" ? "faf-tv-freelance-2008" : "faf-tv-employee-2008";
  }
  if (raw.includes("faf") && (raw.includes("dokumentar") || ["documentary", "docseries", "short"].includes(productionType))) {
    return "faf-documentary";
  }
  if (raw.includes("faf")) return "faf-fiction-2025";
  return null;
}

function hasAgreementReference(data: Record<string, unknown>) {
  if (normalized(data.agreementReferenceStatus) === "yes") return true;
  return isTruthy(data.collectiveAgreement);
}

function dateOnly(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function roleMatches(rule: AgreementPensionRule, value: unknown) {
  const role = normalized(value);
  if (!role) return false;
  return rule.professionRoles.some(item => {
    const candidate = normalized(item);
    return role === candidate || role.includes(candidate) || candidate.includes(role);
  });
}

function withPensionMetadata(data: Record<string, unknown>, patch: Record<string, unknown>) {
  return { ...data, ...patch };
}

export function applyAgreementPension(
  input: Record<string, unknown>,
  rules: AgreementPensionRule[],
): PensionResolution {
  const explicitPercent = finiteNumber(input.pensionPercent);
  const supplier = isSupplierContract(input);

  if (supplier) {
    return {
      applied: false,
      reason: explicitPercent != null ? "supplier_explicit_contract_term" : "supplier_not_covered",
      data: withPensionMetadata(input, {
        pensionStatus: explicitPercent != null ? "explicit_contract" : "not_applicable",
        pensionEmployerPercent: explicitPercent,
        pensionEmployeePercent: explicitPercent != null ? finiteNumber(input.pensionEmployeePercent) ?? 0 : null,
        pensionTotalPercent: explicitPercent != null ? explicitPercent + (finiteNumber(input.pensionEmployeePercent) ?? 0) : null,
        pensionSourceType: explicitPercent != null ? "contract" : null,
        pensionAgreementCode: null,
        pensionAgreementTitle: null,
        pensionAgreementSection: null,
        pensionTag: explicitPercent != null
          ? `Pension ${explicitPercent.toLocaleString("da-DK")}% · individuelt kontraktvilkår (ikke overenskomst)`
          : "Leverandørkontrakt · ikke overenskomstdækket",
      }),
    };
  }

  if (explicitPercent != null) {
    return {
      applied: false,
      reason: "explicit_contract_term",
      data: withPensionMetadata(input, {
        pensionStatus: "explicit_contract",
        pensionEmployerPercent: explicitPercent,
        pensionEmployeePercent: finiteNumber(input.pensionEmployeePercent) ?? 0,
        pensionTotalPercent: explicitPercent + (finiteNumber(input.pensionEmployeePercent) ?? 0),
        pensionSourceType: "contract",
        pensionTag: `Pension ${explicitPercent.toLocaleString("da-DK")}% · kontraktvilkår`,
      }),
    };
  }

  if (!hasAgreementReference(input)) {
    return { applied: false, reason: "agreement_not_explicit", data: withPensionMetadata(input, { pensionStatus: "unknown" }) };
  }

  const agreementCode = identifyAgreementCode(input);
  if (!agreementCode) {
    return {
      applied: false,
      reason: "agreement_ambiguous",
      data: withPensionMetadata(input, {
        pensionStatus: "review_required",
        pensionTag: "Overenskomst nævnt · pensionsregel kræver kontrol",
      }),
    };
  }

  const effectiveDate = dateOnly(input.startDate) ?? dateOnly(input.contractDate);
  const employmentForm = agreementEmploymentForm(input);
  const productionType = String(input.productionType ?? "");
  const creditedFunction = input.creditedFunction ?? input.role ?? input.professionType;
  const candidates = rules.filter(rule =>
    rule.agreementCode === agreementCode
    && rule.agreementStatus !== "draft"
    && rule.status !== "draft"
    && rule.employmentForm === employmentForm
  );

  if (!effectiveDate || !employmentForm || !productionType || !creditedFunction) {
    return {
      applied: false,
      reason: "coverage_data_missing",
      data: withPensionMetadata(input, {
        pensionStatus: "review_required",
        pensionAgreementCode: agreementCode,
        pensionTag: "Overenskomst nævnt · pensionsregel kræver kontrol",
      }),
    };
  }

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
      data: withPensionMetadata(input, {
        pensionStatus: "review_required",
        pensionAgreementCode: agreementCode,
        pensionTag: "Overenskomst nævnt · pensionsregel kræver kontrol",
      }),
    };
  }

  const basisAmount = finiteNumber(input.pensionBasisAmount);
  const calculatedAmount = basisAmount == null ? null : Math.round(basisAmount * rule.employerPercent) / 100;
  return {
    applied: true,
    reason: "approved_agreement_rule",
    data: withPensionMetadata(input, {
      pensionStatus: "inferred_agreement",
      pensionPercent: rule.employerPercent,
      pensionEmployerPercent: rule.employerPercent,
      pensionEmployeePercent: rule.employeePercent,
      pensionTotalPercent: rule.employerPercent + rule.employeePercent,
      pensionBasis: rule.basis,
      pensionSupplement: calculatedAmount,
      pensionAgreementCode: rule.agreementCode,
      pensionAgreementTitle: rule.agreementTitle,
      pensionAgreementSection: rule.sectionReference,
      pensionAgreementSourceUrl: rule.sourceUrl,
      pensionSourceType: "collective_agreement",
      pensionEvidence: `Pension er ikke særskilt angivet i kontrakten og er medregnet efter ${rule.agreementTitle}, ${rule.sectionReference}.`,
      pensionConfidence: "high",
      pensionTag: `Pension ${rule.employerPercent.toLocaleString("da-DK")}% · via ${rule.agreementTitle}`,
      _pensionResolution: {
        appliedAt: new Date().toISOString(),
        ruleId: rule.id,
        effectiveDate,
        reason: "approved_agreement_rule",
      },
    }),
  };
}
