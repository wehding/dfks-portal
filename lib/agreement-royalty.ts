/**
 * Deterministisk royalty-opslag — samme arkitektur som agreement-pension.ts.
 *
 * Registreret godkendt regel vinder over AI's boolean og procentsats — både
 * royalty: true og royaltyPercent sættes fra reglen, uanset om AI'en selv
 * nåede frem til royalty: true. Fallback til AI's vurdering kun hvis ingen
 * godkendt regel findes (individuelt forhandlet royalty i selve kontrakten).
 *
 * En eksplicit procentsats i selve kontrakten har altid forrang over reglen.
 */


export type AgreementRoyaltyRule = {
  id: string;
  agreementCode: string;
  agreementTitle: string;
  agreementStatus: "draft" | "approved" | "archived";
  productionType: string | null;    // null = gælder alle produktionstyper
  distributionType: string | null;  // null = gælder alle distributionstyper
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

export function normalizeRoyaltyProductionType(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("da")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

  if (["feature", "spillefilm", "featurefilm", "dkspillefilm", "uspillefilm"].includes(normalized)) return "feature";
  if (["tvseries", "tvserie", "fiktionsserie"].includes(normalized)) return "tvSeries";
  if (["documentary", "dokumentarfilm", "tvdokumentar"].includes(normalized)) return "documentary";
  if (["docseries", "dokumentarserie"].includes(normalized)) return "docSeries";
  if (["short", "kortfilm", "kortfiktion"].includes(normalized)) return "short";
  return null;
}

function effectiveRuleProductionType(rule: AgreementRoyaltyRule) {
  const configured = normalizeRoyaltyProductionType(rule.productionType);
  if (configured) return configured;
  // Ældre De4-regler blev oprettet uden production_type, selv om selve
  // retsgrundlaget og basisfeltet udtrykkeligt afgrænser royalty til spillefilm.
  return String(rule.basis ?? "").toLocaleLowerCase("da").includes("spillefilm") ? "feature" : null;
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
        royaltySourceType: "individually_negotiated",
        royaltyTag: `Royalty ${explicitPercent.toLocaleString("da-DK")}% · kontraktvilkår`,
      },
    };
  }

  // _resolvedAgreementCode injiceres af server-wrapper via dato-bevidst opslag
  const resolvedCode = typeof input._resolvedAgreementCode === "string" ? input._resolvedAgreementCode : null;
  if (!resolvedCode) {
    // Ingen overenskomst resolveret — fald tilbage til AI's vurdering
    if (!input.royalty) return { applied: false, reason: "royalty_not_flagged", data: input };
    return { applied: false, reason: "agreement_ambiguous", data: input };
  }

  const effectiveDate = dateOnly(input.startDate) ?? dateOnly(input.contractDate);
  const productionType = normalizeRoyaltyProductionType(input.productionType);
  // _workDistributionType injiceres af server-wrapper fra det matchede works-felt
  const workDistributionType = typeof input._workDistributionType === "string" ? input._workDistributionType : null;

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
    // Ingen godkendt regel — bevar AI's vurdering uændret (individuelt forhandlet royalty)
    return { applied: false, reason: "no_approved_royalty_rule", data: input };
  }

  // Find bedste match: specifik productionType > catch-all (null)
  const rule =
    candidates.find(r => effectiveRuleProductionType(r) === productionType) ??
    candidates.find(r => effectiveRuleProductionType(r) == null);

  if (!rule) {
    if (!productionType || input.royalty === true) {
      // En ukendt produktionstype eller et eksplicit kontraktvilkår må ikke
      // ændres til et automatisk nej.
      return { applied: false, reason: "no_matching_production_type", data: input };
    }
    const scopedRule = candidates.find(candidate => effectiveRuleProductionType(candidate) != null);
    if (!scopedRule) return { applied: false, reason: "no_matching_production_type", data: input };
    return {
      applied: true,
      reason: "not_applicable_production_type",
      data: {
        ...input,
        royalty: false,
        royaltyPercent: null,
        royaltySourceType: "collective_agreement",
        royaltyAgreementCode: scopedRule.agreementCode,
        royaltyAgreementTitle: scopedRule.agreementTitle,
        royaltyAgreementSection: scopedRule.sectionReference,
        royaltyTag: `Ingen royalty via ${scopedRule.agreementTitle} · bestemmelsen gælder spillefilm`,
        _royaltyResolution: {
          appliedAt: new Date().toISOString(),
          ruleId: scopedRule.id,
          effectiveDate,
          productionType,
          reason: "not_applicable_production_type",
        },
      },
    };
  }

  // Distributions-filter: en regel med sat distributionType skal matche værkets type
  if (rule.distributionType != null) {
    if (workDistributionType == null) {
      // Regelkravet kendes, men værkets distributionstype er ikke sat — kan ikke bekræfte
      return { applied: false, reason: "distribution_type_unknown", data: input };
    }
    if (workDistributionType !== rule.distributionType) {
      // Regelkravet matcher ikke den kendte distributionstype
      return { applied: false, reason: "no_matching_distribution_type", data: input };
    }
  }

  return {
    applied: true,
    reason: "approved_agreement_rule",
    data: {
      ...input,
      // Registreret regel vinder over AI's boolean — sæt royalty: true uanset AI's vurdering
      royalty: true,
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
