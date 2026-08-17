export const CONTRACT_ADVICE_SCHEMA_VERSION = "advice-v2";
export const CONTRACT_ADVICE_PROMPT_VERSION = "contract-advice-2026-08-17";

const RULE_PATTERNS: Array<[RegExp, string]> = [
  [/pension/i, "pension"], [/copydan/i, "copydan"], [/(svod|streaming)/i, "svod"],
  [/(tdm|data.?mining|kunstig intelligens|ai)/i, "tdm_ai"], [/promover/i, "promovering"],
  [/krediter/i, "kreditering"], [/opsig/i, "opsigelsesvarsel"], [/sygdom/i, "sygdom"],
  [/royalty/i, "royalty"], [/(hybrid|blanding.*kontrakt)/i, "hybrid_kontrakt"],
  [/underskrift|signatur/i, "underskrift"], [/overenskomst/i, "overenskomst"],
  [/(minimums|mindsteløn|løn.*minimum)/i, "minimumsloen"], [/feriepenge|feriegodtg/i, "feriepenge"],
  [/beta/i, "beta_bidrag"],
];

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export function adviceRuleCode(point: Record<string, unknown>) {
  const supplied = text(point.rule_code ?? point.point_id).toLocaleLowerCase("da");
  if (/^[a-z0-9_\-]{2,80}$/.test(supplied)) return supplied.replaceAll("-", "_");
  const source = [point.id, point.titel, point.title, point.beskrivelse, point.description].map(text).join(" ");
  return RULE_PATTERNS.find(([pattern]) => pattern.test(source))?.[1] ?? null;
}

export function normalizedAdviceCompliance(result: Record<string, unknown>) {
  const overview = result.overblik && typeof result.overblik === "object" ? result.overblik as Record<string, unknown> : {};
  const points = Array.isArray(result.feedbackpunkter) ? result.feedbackpunkter : [];
  const documentStage = ["draft", "unsigned", "signed", "unknown"].includes(text(result.document_stage)) ? text(result.document_stage) : "unknown";
  const agreementStatus = ["present", "missing", "unclear", "not_applicable", "unknown"].includes(text(result.agreement_status))
    ? text(result.agreement_status)
    : text(overview.overenskomst) ? "present" : "unknown";
  return {
    schema_version: CONTRACT_ADVICE_SCHEMA_VERSION,
    prompt_version: CONTRACT_ADVICE_PROMPT_VERSION,
    document_stage: documentStage,
    agreement_status: agreementStatus,
    overenskomst_navn: text(overview.overenskomst) || null,
    risk_level: text(result.risk_level).toUpperCase() || null,
    should_escalate: result.should_escalate === true,
    points: points.flatMap(value => {
      if (!value || typeof value !== "object") return [];
      const point = value as Record<string, unknown>;
      const ruleCode = adviceRuleCode(point);
      if (!ruleCode) return [];
      const rawSeverity = text(point.severity ?? point.type).toLocaleLowerCase("da");
      return [{
        point_id: ruleCode,
        severity: rawSeverity === "kritisk" || rawSeverity === "høj" ? "HØJ" : rawSeverity === "advarsel" || rawSeverity === "mellem" ? "MELLEM" : "LAV",
        finding_status: rawSeverity === "positiv" ? "positive" : "present",
        requires_producer_text: point.requires_producer_text === true,
      }];
    }),
  };
}
