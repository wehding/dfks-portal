/**
 * Deterministisk royalty-opslag — samme arkitektur som agreement-pension.ts.
 *
 * Royaltyprocenten hentes fra agreement_percentage_rules (label_key = 'royalty')
 * for den relevante overenskomst og produktionstype. Hvis ingen godkendt regel
 * findes, forbliver royaltyPercent uændret (null, eller hvad AI fandt i kontrakten).
 *
 * En eksplicit procentsats i selve kontrakten har altid forrang.
 */


export type AgreementRoyaltyRule = {
  id: string;
  agreementCode: string;
  agreementTitle: string;
  agreementStatus: "draft" | "approved" | "archived";
  productionType: string | null;   // null = gælder alle produktionstyper
  percent: number;
  basis: string;
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

export type RoyaltyResolution = {
  data: Record<string, unknown>;
  applied: boolean;
  reason: string;
};

export function applyAgreementRoyalty(
  input: Record<string, unknown>,
  rules: AgreementRoyaltyRule[],
): RoyaltyResolution {
  // Eksplicit procentsats i kontrakten → bevar den, anvend ingen regel
  const explicitPercent = finiteNumber(input.royaltyPercent);
  if (explicitPercent != null) {
    return {
      applied: false,
      reason: "explicit_contract_term",
      data: {
        ...input,
        royaltySourceType: "contract",
        royaltyTag: `Royalty ${explicitPercent.toLocaleString("da-DK")}% · kontraktvilkår`,
      },
    };
  }

  // Ingen royalty-flag → ikke relevant
  if (!input.royalty) {
    return { applied: false, reason: "royalty_not_flagged", data: input };
  }

  // _resolvedAgreementCode injiceres af server-wrapper via dato-bevidst opslag
  const resolvedCode = typeof input._resolvedAgreementCode === "string" ? input._resolvedAgreementCode : null;
  if (!resolvedCode) {
    return { applied: false, reason: "agreement_ambiguous", data: input };
  }

  const effectiveDate = dateOnly(input.startDate) ?? dateOnly(input.contractDate);
  const productionType = String(input.productionType ?? "");

  // Regler er allerede pre-filtreret på agreement_id af server-wrapperen — status-filter er tilstrækkeligt
  const candidates = rules.filter(rule =>
    rule.agreementStatus !== "draft"
    && rule.status !== "draft"
    && (effectiveDate == null || (
      rule.validFrom <= effectiveDate
      && (rule.validTo == null || rule.validTo >= effectiveDate)
    ))
  );

  if (!candidates.length) {
    return { applied: false, reason: "no_approved_royalty_rule", data: input };
  }

  // Find bedste match: specifik productionType > catch-all (null)
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
      royaltyPercent: rule.percent,
      royaltySourceType: "collective_agreement",
      royaltyAgreementCode: rule.agreementCode,
      royaltyAgreementTitle: rule.agreementTitle,
      royaltyAgreementSection: rule.sectionReference,
      royaltyTag: `Royalty ${rule.percent.toLocaleString("da-DK")}% · via ${rule.agreementTitle}`,
      _royaltyResolution: {
        appliedAt: new Date().toISOString(),
        ruleId: rule.id,
        effectiveDate,
        productionType,
        reason: "approved_agreement_rule",
      },
    },
  };
}
