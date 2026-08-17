import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { normalizeStatisticsMinimumGroupSize } from "@/lib/statistics-privacy";

export type ContractAdviceStatisticsFilters = {
  years?: number[];
  contractTypes?: string[];
  productionTypes?: string[];
  intakeSources?: string[];
  ruleCodes?: string[];
};

type AdviceFact = {
  fact_type: "review" | "issue" | "comparison";
  review_id: string | null;
  member_key: string | null;
  period_year: number;
  intake_source: string | null;
  review_status: string | null;
  analysis_status: string | null;
  contract_type: string | null;
  production_type: string | null;
  document_stage: string | null;
  agreement_status: string | null;
  agreement_name: string | null;
  risk_level: string | null;
  should_escalate: boolean;
  rule_code: string | null;
  severity: string | null;
  human_assessment: string | null;
  correction_outcome: string | null;
  confidence: number | null;
  received_at: string | null;
  analysed_at: string | null;
  responded_at: string | null;
  completed_at: string | null;
  analysis_latency_seconds: number | null;
  response_latency_seconds: number | null;
  completion_latency_seconds: number | null;
  prompt_version: string | null;
  schema_version: string | null;
};

const RULE_LABELS: Record<string, string> = {
  pension: "Pension", copydan: "Copydan-forbehold", svod: "Streaming/SVOD",
  tdm_ai: "TDM/AI", promovering: "Promoveringsret", kreditering: "Kreditering",
  opsigelsesvarsel: "Opsigelsesvarsel", sygdom: "Sygdomsbestemmelse",
  royalty: "Royalty", hybrid_kontrakt: "Blanding af kontraktformer",
  underskrift: "Underskrift", overenskomst: "Overenskomsthenvisning",
  kontraktform: "Kontraktform", minimumsloen: "Minimumsløn",
  feriepenge: "Feriepenge", beta_bidrag: "BETA-bidrag",
  producent_overenskomst: "Producentens overenskomstdækning",
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, number>();
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + 1);
  return [...result.entries()].map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "da"));
}

function subjectKey(row: AdviceFact) {
  return row.member_key ?? row.review_id;
}

function visibleGroup(rows: AdviceFact[], minimum: number) {
  return new Set(rows.map(subjectKey).filter(Boolean)).size >= minimum;
}

function safeGroups(rows: AdviceFact[], minimum: number, key: (row: AdviceFact) => string) {
  const groups = new Map<string, AdviceFact[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups.entries()].filter(([, group]) => visibleGroup(group, minimum));
}

function inFilter(value: string | null, filter?: string[]) {
  return !filter?.length || Boolean(value && filter.includes(value));
}

export async function getContractAdviceStatistics(orgId: string, filters: ContractAdviceStatisticsFilters = {}) {
  const db = createServiceClient();
  const { data: organisation, error: organisationError } = await db.from("organisations")
    .select("statistics_minimum_group_size").eq("id", orgId).single();
  if (organisationError) throw new Error(organisationError.message);
  const factPages: AdviceFact[] = [];
  for (let pageOffset = 0; pageOffset < 100_000; pageOffset += 1000) {
    const { data: page, error } = await db.rpc("get_contract_advice_statistics_facts", {
      target_org_id: orgId, page_offset: pageOffset, page_size: 1000,
    });
    if (error) throw new Error(error.message);
    factPages.push(...((page ?? []) as AdviceFact[]));
    if ((page?.length ?? 0) < 1000) break;
  }
  const minimum = normalizeStatisticsMinimumGroupSize(organisation.statistics_minimum_group_size);
  const allRows = factPages;
  const { data: usageRuns } = await db.from("ai_usage_runs")
    .select("id,status,error_code")
    .eq("org_id", orgId)
    .eq("operation_type", "contract_advice")
    .order("started_at", { ascending: false })
    .limit(5000);
  const runIds = (usageRuns ?? []).map(run => run.id);
  const { data: usageEvents } = runIds.length
    ? await db.from("ai_usage_events").select("run_id,model,cost_dkk,latency_ms,status,error_code").in("run_id", runIds).limit(10000)
    : { data: [] as Array<{ run_id: string; model: string; cost_dkk: number | null; latency_ms: number | null; status: string; error_code: string | null }> };
  const reviews = allRows.filter(row => row.fact_type === "review")
    .filter(row => !filters.years?.length || filters.years.includes(Number(row.period_year)))
    .filter(row => inFilter(row.contract_type, filters.contractTypes))
    .filter(row => inFilter(row.production_type, filters.productionTypes))
    .filter(row => inFilter(row.intake_source, filters.intakeSources));
  const includedReviews = new Set(reviews.map(row => row.review_id).filter(Boolean));
  const issues = allRows.filter(row => row.fact_type === "issue" && includedReviews.has(row.review_id))
    .filter(row => inFilter(row.rule_code, filters.ruleCodes));
  const comparisons = allRows.filter(row => row.fact_type === "comparison")
    .filter(row => !filters.years?.length || filters.years.includes(Number(row.period_year)))
    .filter(row => inFilter(row.rule_code, filters.ruleCodes));
  const years = [...new Set(allRows.filter(row => row.fact_type === "review").map(row => Number(row.period_year)))].sort((a, b) => b - a);

  if (!visibleGroup(reviews, minimum)) {
    return { suppressed: true, minimum, years, caseCount: null, memberCount: null };
  }

  const memberCount = new Set(reviews.map(subjectKey).filter(Boolean)).size;
  const byYear = safeGroups(reviews, minimum, row => String(row.period_year)).map(([year, group]) => ({
    year: Number(year),
    received: group.length,
    analysed: group.filter(row => row.analysed_at).length,
    responded: group.filter(row => row.responded_at).length,
    completed: group.filter(row => row.completed_at || row.review_status === "afsluttet").length,
    escalated: group.filter(row => row.should_escalate).length,
    memberCount: new Set(group.map(subjectKey).filter(Boolean)).size,
  })).sort((a, b) => a.year - b.year);

  const issueGroups = safeGroups(issues, minimum, row => row.rule_code ?? "unknown");
  const issueFrequency = issueGroups.map(([ruleCode, group]) => ({
    ruleCode,
    label: RULE_LABELS[ruleCode] ?? ruleCode.replaceAll("_", " "),
    count: group.length,
    sharePercent: reviews.length ? Math.round(group.length / reviews.length * 100) : 0,
    highSeverity: group.filter(row => row.severity === "HØJ").length,
    assessed: group.filter(row => row.human_assessment !== "unreviewed").length,
    correct: group.filter(row => row.human_assessment === "correct").length,
    incorrect: group.filter(row => ["incorrect", "wrong_severity", "not_relevant"].includes(row.human_assessment ?? "")).length,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "da"));

  const correctionGroups = safeGroups(comparisons, minimum, row => row.rule_code ?? "unknown");
  const corrections = correctionGroups.map(([ruleCode, group]) => {
    const certain = group.filter(row => (row.confidence ?? 0) >= 0.7);
    return {
      ruleCode,
      label: RULE_LABELS[ruleCode] ?? ruleCode.replaceAll("_", " "),
      compared: group.length,
      fixed: certain.filter(row => row.correction_outcome === "fixed").length,
      notFixed: certain.filter(row => row.correction_outcome === "not_fixed").length,
      newIssues: certain.filter(row => row.correction_outcome === "new_issue").length,
      uncertain: group.length - certain.length + certain.filter(row => row.correction_outcome === "uncertain").length,
    };
  }).sort((a, b) => b.compared - a.compared || a.label.localeCompare(b.label, "da"));

  const feedback = issues.filter(row => row.human_assessment !== "unreviewed");
  const duration = (key: "analysis_latency_seconds" | "response_latency_seconds" | "completion_latency_seconds") =>
    reviews.map(row => row[key]).filter((value): value is number => Number.isFinite(value) && Number(value) >= 0);

  return {
    suppressed: false,
    minimum,
    years,
    caseCount: reviews.length,
    memberCount,
    byYear,
    workflow: {
      awaiting: reviews.filter(row => row.review_status === "afventer").length,
      processing: reviews.filter(row => row.review_status === "behandling").length,
      completed: reviews.filter(row => row.review_status === "afsluttet" || row.completed_at).length,
      analysisFailures: reviews.filter(row => ["failed", "fejlet"].includes(row.analysis_status ?? "")).length,
      escalated: reviews.filter(row => row.should_escalate).length,
      medianAnalysisSeconds: median(duration("analysis_latency_seconds")),
      medianResponseSeconds: median(duration("response_latency_seconds")),
      p90ResponseSeconds: percentile(duration("response_latency_seconds"), 0.9),
      medianCompletionSeconds: median(duration("completion_latency_seconds")),
    },
    intakeSources: countBy(reviews, row => row.intake_source ?? "unknown"),
    documentStages: countBy(reviews, row => row.document_stage ?? "unknown"),
    agreementStatuses: countBy(reviews, row => row.agreement_status ?? "unknown"),
    agreementNames: countBy(reviews.filter(row => row.agreement_name), row => row.agreement_name ?? "unknown"),
    contractTypes: countBy(reviews, row => row.contract_type ?? "unknown"),
    productionTypes: countBy(reviews, row => row.production_type ?? "unknown"),
    riskLevels: countBy(reviews, row => row.risk_level ?? "unknown"),
    issueFrequency,
    corrections,
    aiQuality: {
      totalFindings: issues.length,
      assessedFindings: feedback.length,
      correctFindings: feedback.filter(row => row.human_assessment === "correct").length,
      incorrectFindings: feedback.filter(row => row.human_assessment === "incorrect").length,
      wrongSeverity: feedback.filter(row => row.human_assessment === "wrong_severity").length,
      notRelevant: feedback.filter(row => row.human_assessment === "not_relevant").length,
      missedFindings: feedback.filter(row => row.human_assessment === "missed").length,
      assessmentCoveragePercent: issues.length ? Math.round(feedback.length / issues.length * 100) : 0,
      precisionPercent: feedback.length ? Math.round(feedback.filter(row => row.human_assessment === "correct").length / feedback.length * 100) : null,
    },
    aiOperations: {
      runs: usageRuns?.length ?? 0,
      succeeded: (usageRuns ?? []).filter(run => run.status === "succeeded").length,
      failed: (usageRuns ?? []).filter(run => run.status === "failed").length,
      totalCostDkk: Math.round((usageEvents ?? []).reduce((sum, event) => sum + Number(event.cost_dkk ?? 0), 0) * 100) / 100,
      medianLatencyMs: median((usageEvents ?? []).map(event => Number(event.latency_ms)).filter(value => Number.isFinite(value) && value >= 0)),
      models: countBy(usageEvents ?? [], event => event.model || "unknown"),
      errors: countBy((usageEvents ?? []).filter(event => event.status === "failed"), event => event.error_code || "unknown"),
    },
  };
}
