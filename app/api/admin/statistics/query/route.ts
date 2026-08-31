import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { AiProviderHttpError, callAi } from "@/lib/ai-client";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import { createAiUsageRun, finishAiUsageRun } from "@/lib/ai-usage";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getAdminStatistics } from "@/lib/admin-statistics";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import {
  extractStatisticsSeries,
  parseStatisticsQueryPlan,
  predefinedStatisticsQueryPlan,
  STATISTICS_METRIC_META,
  STATISTICS_QUERY_PLAN_SCHEMA,
  statisticsQuerySystemPrompt,
  StatisticsQueryPlanError,
  type StatisticsMetric,
  type StatisticsQueryPlan,
} from "@/lib/statistics-query-plan";
import { buildStatisticsQuerySegments, describeStatisticsPlan } from "@/lib/statistics-query-execution";
import { createServiceClient } from "@/lib/supabase/service";
import { getAnnualCpi } from "@/lib/statistics-cpi";
import { companyMatchScore, normalizeCompanyBaseName, type ProductionCompanyOption } from "@/lib/production-companies";
import { salaryDataToMonthly } from "@/lib/statistics-calculations";
import { sampleSizeBand } from "@/lib/statistics/privacy-guard";
import { experienceGroupAt } from "@/lib/experience-groups";
import { normalizeStatisticsMinimumGroupSize } from "@/lib/statistics-privacy";
import { buildStatisticsVisualization } from "@/lib/statistics/visualization";
import { collectOmittedStatisticsPoints, describeOmittedStatisticsPoints, type OmittedStatisticsPoint } from "@/lib/statistics/omitted-points";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import type { AuditContext } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type ProducerCandidate = { id: string; name: string; score: number };
const STATISTICS_CALCULATION_VERSION = "union-stats-v1";
const AUTO_PRODUCER_LIMIT = 5;

async function recordStatisticsAudit(input: {
  orgId: string;
  actorUserId: string;
  plan: unknown;
  suppressionCount: number;
  pointCount: number;
  seriesCount: number;
  policy: {
    minimumGroupSize: number;
    dominanceLimit: number;
    calculationVersion: string;
  };
  context: AuditContext;
}) {
  const fingerprint = createHash("sha256").update(JSON.stringify(input.plan)).digest("hex");
  const auditEventId = await recordAuditEvent({
    context: input.context,
    action: "ai_analysis",
    entityType: "statistics_query",
    entityLabel: "Anonymiseret statistikforespørgsel",
    purposeCode: "collective_statistics",
    legalBasis: "GDPR Art. 9(2)(d)",
    dataCategories: ["contract_data", "salary_data", "union_membership_data", "aggregated_statistics"],
    orgIds: [input.orgId],
    metadata: {
      queryFingerprint: fingerprint,
      calculationVersion: input.policy.calculationVersion,
      suppressionCount: input.suppressionCount,
      pointCount: input.pointCount,
      seriesCount: input.seriesCount,
      statisticsPolicy: {
        minimumGroupSize: input.policy.minimumGroupSize,
        dominanceLimit: input.policy.dominanceLimit,
      },
    },
  });
  const { error } = await createServiceClient().rpc("record_statistics_query_audit", {
    target_org_id: input.orgId,
    target_actor_user_id: input.actorUserId,
    target_query_fingerprint: fingerprint,
    target_calculation_version: input.policy.calculationVersion,
    target_suppression_count: input.suppressionCount,
    target_result_shape: { pointCount: input.pointCount, seriesCount: input.seriesCount },
    target_audit_event_id: auditEventId,
  });
  if (error) throw new Error("Statistikforespørgslen kunne ikke revisionslogges sikkert.");
}

async function resolveProducerNames(names: string[]) {
  if (!names.length) return { resolved: [] as Array<{ id: string; name: string }>, ambiguous: null as null | { query: string; candidates: ProducerCandidate[] } };
  const db = createServiceClient();
  const { data, error } = await db.from("employers")
    .select("id,name,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_number,entity_kind,is_primary,registration_status,website,archived_at)")
    .is("merged_into_id", null).is("archived_at", null).limit(5000);
  if (error) throw new Error("Producentregisteret kunne ikke hentes.");
  const options: ProductionCompanyOption[] = (data ?? []).map(employer => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map(alias => alias.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter(entity => !entity.archived_at).map(entity => ({
      id: entity.id,
      legalName: entity.legal_name,
      registrationCountry: "DK",
      registrationType: "CVR",
      registrationNumber: entity.registration_number,
      entityKind: entity.entity_kind as "company" | "subsidiary" | "spv",
      isPrimary: entity.is_primary,
      registrationStatus: entity.registration_status,
      website: entity.website,
    })),
    isVerified: true,
  }));

  const resolved: Array<{ id: string; name: string }> = [];
  for (const name of names) {
    const candidates = options.map(option => {
      const exact = [option.canonicalName, ...option.aliases, ...option.legalEntities.map(entity => entity.legalName)]
        .some(candidate => normalizeCompanyBaseName(candidate) === normalizeCompanyBaseName(name));
      return { id: option.employerId, name: option.canonicalName, score: exact ? 200 : companyMatchScore(option, name) };
    }).filter(candidate => candidate.score >= 50)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "da-DK"))
      .slice(0, 5);
    const best = candidates[0];
    const second = candidates[1];
    if (!best) return { resolved, ambiguous: { query: name, candidates: [] } };
    if (best.score < 100 || (second && best.score - second.score < 10)) {
      return { resolved, ambiguous: { query: name, candidates } };
    }
    if (!resolved.some(item => item.id === best.id)) resolved.push({ id: best.id, name: best.name });
  }
  return { resolved, ambiguous: null };
}

type ProducerRankingFact = {
  rights_holder_id: string;
  contract_status: "valideret" | "kladde";
  period_year: number | null;
  contract_type: string | null;
  production_type: string | null;
  gender: string | null;
  producer_ids: string[] | null;
  producer_type_codes: string[] | null;
  membership_types: string[] | null;
  profession_type: string | null;
  professional_start_year: number | null;
  statistics_data: Record<string, unknown> | null;
};

function valuesOverlap(left: string[] | null | undefined, right: string[]) {
  return !right.length || right.some(value => (left ?? []).includes(value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function producerRankingFactMatchesPlan(fact: ProducerRankingFact, plan: StatisticsQueryPlan) {
  const year = Number(fact.period_year);
  if (!Number.isInteger(year)) return false;
  if (plan.filters.years.length && !plan.filters.years.includes(year)) return false;
  if (plan.filters.categories.length && (!fact.production_type || !plan.filters.categories.includes(fact.production_type as never))) return false;
  if (plan.filters.contractTypes.length && (!fact.contract_type || !plan.filters.contractTypes.includes(fact.contract_type as never))) return false;
  if (plan.filters.genders.length && (!fact.gender || !plan.filters.genders.includes(fact.gender as never))) return false;
  if (plan.filters.producerTypeCodes.length && !valuesOverlap(fact.producer_type_codes, plan.filters.producerTypeCodes)) return false;
  if (plan.filters.membershipTypes.length) {
    const memberships = fact.membership_types?.length ? fact.membership_types : ["none"];
    if (!valuesOverlap(memberships, plan.filters.membershipTypes)) return false;
  }
  if (plan.filters.professionTypes.length) {
    const profession = String(fact.profession_type ?? "").trim().toLocaleLowerCase("da");
    if (!plan.filters.professionTypes.map(value => value.trim().toLocaleLowerCase("da")).includes(profession)) return false;
  }
  if (plan.filters.experienceGroups.length) {
    const group = experienceGroupAt(fact.professional_start_year == null ? null : Number(fact.professional_start_year), year);
    if (!group || !plan.filters.experienceGroups.includes(group)) return false;
  }
  return true;
}

function personWeightedMedianSalary(rows: Array<{ rightsHolderId: string; monthlySalary: number }>) {
  const byPerson = new Map<string, number[]>();
  for (const row of rows) byPerson.set(row.rightsHolderId, [...(byPerson.get(row.rightsHolderId) ?? []), row.monthlySalary]);
  return median([...byPerson.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length));
}

async function resolveTopSalaryProducers(orgId: string, plan: StatisticsQueryPlan) {
  const db = createServiceClient();
  const { data: organisation, error: organisationError } = await db.from("organisations")
    .select("statistics_contract_scope,statistics_minimum_group_size")
    .eq("id", orgId)
    .single();
  if (organisationError) throw new Error("Organisationens statistikindstillinger kunne ikke hentes.");
  const includeDrafts = organisation.statistics_contract_scope === "validated_and_drafts";
  const minimumGroupSize = normalizeStatisticsMinimumGroupSize(organisation.statistics_minimum_group_size);
  const { data, error } = await db.rpc("get_statistics_facts", {
    target_org_id: orgId,
    include_drafts: includeDrafts,
  });
  if (error) throw new Error("Statistikgrundlaget kunne ikke hentes til producentrangering.");

  const byProducer = new Map<string, Array<{ rightsHolderId: string; monthlySalary: number }>>();
  for (const fact of (data ?? []) as ProducerRankingFact[]) {
    if (!producerRankingFactMatchesPlan(fact, plan)) continue;
    const monthlySalary = salaryDataToMonthly(fact.statistics_data ?? {});
    if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) continue;
    for (const producerId of fact.producer_ids ?? []) {
      byProducer.set(producerId, [...(byProducer.get(producerId) ?? []), { rightsHolderId: fact.rights_holder_id, monthlySalary }]);
    }
  }

  const ranked = [...byProducer.entries()].map(([id, rows]) => ({
    id,
    memberCount: new Set(rows.map(row => row.rightsHolderId)).size,
    contractCount: rows.length,
    salary: personWeightedMedianSalary(rows),
  })).filter(row => row.memberCount >= minimumGroupSize && row.salary > 0)
    .sort((left, right) => right.salary - left.salary || right.memberCount - left.memberCount || right.contractCount - left.contractCount)
    .slice(0, AUTO_PRODUCER_LIMIT);
  if (!ranked.length) return [];

  const { data: employers, error: employersError } = await db.from("employers")
    .select("id,name")
    .in("id", ranked.map(row => row.id))
    .is("merged_into_id", null)
    .is("archived_at", null);
  if (employersError) throw new Error("Producentnavne kunne ikke hentes.");
  const names = new Map((employers ?? []).map(employer => [employer.id, employer.name]));
  return ranked.flatMap(row => {
    const name = names.get(row.id);
    return name ? [{ id: row.id, name }] : [];
  });
}

function classifyStatisticsQueryError(error: unknown) {
  if (error instanceof StatisticsQueryPlanError) {
    const details = {
      unsupported_metric: ["Spørgsmålet handler om et mål, som den sikre statistikmotor endnu ikke understøtter.", "Spørg fx til løn, pension, arbejdsuger, antal kontrakter, bidrag eller rettighedsforbehold."],
      unsupported_grouping: ["Spørgsmålet kræver en gruppering, som statistikmotoren endnu ikke understøtter.", "Brug år og højst to sammenligninger som produktionstype, kontrakttype eller producent."],
      person_query_not_allowed: ["Statistikmodulet må ikke vise eller rangere identificerbare personers løn- eller kontraktdata.", "Spørg i stedet til en anonymiseret gruppe med organisationens minimumsgrundlag."],
      missing_comparison_values: ["Systemet kan se, hvad der skal sammenlignes, men mangler navnene på grupperne.", "Skriv de konkrete faggrupper, producenter eller producenttyper i spørgsmålet."],
      too_many_series: ["Spørgsmålet giver for mange samtidige kombinationer til en overskuelig og sikker visning.", "Brug højst fire mål og to sammenligningsdimensioner, eller gør grupperingen bredere."],
      missing_plan: ["Spørgsmålet indeholdt ikke nok oplysninger til at vælge et sikkert statistikmål.", "Skriv hvilket mål og eventuelt hvilken periode eller sammenligning du ønsker."],
    }[error.code];
    return { status: 422, errorCode: error.code, reason: details[0], suggestion: details[1] } as const;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof AiProviderHttpError && error.failureClass === "input") {
    return {
      status: 503, errorCode: "ai_request_invalid",
      reason: "Den valgte statistikmodel afviste den lukkede forespørgselsplan.",
      suggestion: "Prøv et af standardforslagene. En administrator kan kontrollere modelvalget i AI-kontrolrummet.",
    } as const;
  }
  if (error instanceof AiProviderHttpError || error instanceof SyntaxError || /api-nøgle|ukendt ai-udbyder|timeout|fetch failed/.test(message)) {
    return {
      status: 503,
      errorCode: error instanceof SyntaxError ? "ai_invalid_response" : error instanceof AiProviderHttpError ? `ai_${error.failureClass}` : "ai_unavailable",
      reason: "Statistikassistentens sprogfortolkning er midlertidigt utilgængelig. De indbyggede standardspørgsmål virker stadig uden AI.",
      suggestion: "Prøv en enkel formulering med løn, pension, arbejdsuger, kontrakter eller rettighedsforbehold og en periode.",
    } as const;
  }
  return {
    status: 500, errorCode: "statistics_data_error",
    reason: "Statistikgrundlaget kunne ikke beregnes lige nu.",
    suggestion: "Prøv igen. Hvis fejlen fortsætter, skal databasefunktionen kontrolleres af en administrator.",
  } as const;
}

function applyInflation<T extends { metric: StatisticsMetric; seriesKey: string; year: number; value: number }>(
  rows: T[],
  inflation: Array<{ year: number; index: number }>,
) {
  const inflationMap = new Map(inflation.map(row => [row.year, row.index]));
  const bySeries = new Map<string, T[]>();
  for (const row of rows) bySeries.set(row.seriesKey, [...(bySeries.get(row.seriesKey) ?? []), row]);
  return [...bySeries.values()].flatMap(seriesRows => {
    const sorted = [...seriesRows].sort((left, right) => left.year - right.year);
    const baseline = sorted.find(row => inflationMap.has(row.year));
    return sorted.map(row => {
      const isSalary = row.metric === "median_monthly_salary" || row.metric === "average_monthly_salary";
      if (!isSalary || !baseline) return { ...row, inflationIndex: null, realValue: null, realChangePercent: null };
      const baseIndex = inflationMap.get(baseline.year);
      const currentIndex = inflationMap.get(row.year);
      if (!baseIndex || !currentIndex) return { ...row, inflationIndex: currentIndex ?? null, realValue: null, realChangePercent: null };
      const realValue = Math.round(row.value * baseIndex / currentIndex);
      const realChangePercent = baseline.value > 0 ? Math.round((realValue / baseline.value - 1) * 1000) / 10 : null;
      return { ...row, inflationIndex: currentIndex, realValue, realChangePercent };
    });
  });
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  const auditContext = auditRequestContext(request, caller, "admin", "admin.statistics.query");
  const rateLimit = await consumeRateLimit({
    bucket: "statistics-query",
    identifier: createHash("sha256").update(`${caller.orgId}:${caller.userId}`).digest("hex"),
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "For mange statistikforespørgsler", reason: "Forespørgselsgrænsen beskytter små grupper mod differensangreb.", suggestion: "Prøv igen senere." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (question.length < 5) return NextResponse.json({ error: "Skriv et statistikspørgsmål." }, { status: 400 });

  const runId = await createAiUsageRun({
    orgId: caller.orgId, operationType: "statistics_query", entityType: "statistics_query",
    actorUserId: caller.userId, source: "admin",
  });
  try {
    const deterministicPlan = predefinedStatisticsQueryPlan(question);
    let response: string | null = null;
    let interpretedBy: "rules" | "ai" = "rules";
    if (!deterministicPlan) {
      interpretedBy = "ai";
      const runtime = await getAiRuntimeConfig("statistics_query");
      response = await callAi({
        provider: runtime.provider,
        model: runtime.model,
        system: statisticsQuerySystemPrompt(),
        userMessage: question,
        maxTokens: 900,
        responseJson: true,
        responseSchema: STATISTICS_QUERY_PLAN_SCHEMA,
        promptCaching: runtime.promptCachingEnabled,
        usageContext: { runId, orgId: caller.orgId, useCase: "statistics_query", stage: "query" },
      });
    }
    const jsonText = response?.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const plan = deterministicPlan ?? parseStatisticsQueryPlan(JSON.parse(jsonText ?? ""));
    const producers = await resolveProducerNames(plan.filters.producerNames);
    if (producers.ambiguous) {
      await finishAiUsageRun(runId, "succeeded");
      return NextResponse.json({
        error: producers.ambiguous.candidates.length ? "Producentnavnet er tvetydigt. Vælg en producent." : "Producenten blev ikke fundet i producentregisteret.",
        reason: producers.ambiguous.candidates.length
          ? `Flere producenter matcher “${producers.ambiguous.query}” næsten lige godt.`
          : `“${producers.ambiguous.query}” kunne ikke matches sikkert med producentregisteret.`,
        suggestion: producers.ambiguous.candidates.length
          ? `Præcisér navnet, fx ${producers.ambiguous.candidates.slice(0, 3).map(candidate => candidate.name).join(", ")}.`
          : "Kontrollér producentnavnet eller brug et bredere spørgsmål uden producentfilter.",
        code: "ambiguous_producer", query: producers.ambiguous.query, candidates: producers.ambiguous.candidates,
      }, { status: 409 });
    }

    const autoSelectedProducers = plan.compareBy.includes("producer") && !plan.filters.producerNames.length
      ? await resolveTopSalaryProducers(caller.orgId, plan)
      : [];
    const resolvedProducers = producers.resolved.length ? producers.resolved : autoSelectedProducers;
    const segments = buildStatisticsQuerySegments(plan, resolvedProducers);
    const allSeries: ReturnType<typeof extractStatisticsSeries> = [];
    let minimum = 5;
    let dominanceLimit = 0.8;
    let includeDrafts = false;
    let suppressedSegments = 0;
    let suppressedCells = 0;
    const omittedData: OmittedStatisticsPoint[] = [];
    const suppressionReasons: Record<string, number> = {};
    for (const segment of segments) {
      const statistics = await getAdminStatistics(caller.orgId, segment.filters);
      const statisticsRecord = statistics as unknown as Record<string, unknown>;
      minimum = statistics.minimum;
      dominanceLimit = Number(statistics.dominanceLimit ?? dominanceLimit);
      includeDrafts ||= Boolean(statistics.includeDrafts);
      suppressedCells += Number(statistics.suppressionCount ?? 0);
      const reasons = typeof statistics.suppressionReasons === "object" && statistics.suppressionReasons
        ? statistics.suppressionReasons as Record<string, number>
        : {};
      for (const [reason, count] of Object.entries(reasons)) suppressionReasons[reason] = (suppressionReasons[reason] ?? 0) + Number(count);
      if (statistics.suppressed) {
        suppressedSegments += 1;
        omittedData.push({
          year: null,
          seriesLabel: segment.label,
          metricLabel: plan.metrics.map(metric => STATISTICS_METRIC_META[metric].label).join(", "),
          reason: "suppressed_segment",
          memberCount: typeof statisticsRecord.memberCount === "number" ? statisticsRecord.memberCount : null,
          contractCount: typeof statisticsRecord.contractCount === "number" ? statisticsRecord.contractCount : null,
        });
        continue;
      }
      omittedData.push(...collectOmittedStatisticsPoints({
        metrics: plan.metrics,
        statistics: statisticsRecord,
        segmentLabel: segment.label === "Samlet resultat" ? "" : segment.label,
      }));
      for (const metric of plan.metrics) {
        const meta = STATISTICS_METRIC_META[metric];
        const segmentLabel = segment.label === "Samlet resultat" ? "" : segment.label;
        const label = plan.metrics.length > 1
          ? [meta.label, segmentLabel].filter(Boolean).join(" · ")
          : segmentLabel || meta.label;
        allSeries.push(...extractStatisticsSeries(metric, statistics as unknown as Record<string, unknown>, `${metric}__${segment.key}`, label));
      }
    }

    if (!allSeries.length) {
      await recordStatisticsAudit({
        orgId: caller.orgId, actorUserId: caller.userId, plan,
        suppressionCount: suppressedSegments + suppressedCells, pointCount: 0, seriesCount: 0,
        policy: { minimumGroupSize: minimum, dominanceLimit, calculationVersion: STATISTICS_CALCULATION_VERSION },
        context: auditContext,
      });
      await finishAiUsageRun(runId, "succeeded");
      return NextResponse.json({
        suppressed: true, minimum, plan, interpretedBy,
        minimumGroupSize: minimum,
        dominanceLimit,
        calculationVersion: STATISTICS_CALCULATION_VERSION,
        understoodAs: describeStatisticsPlan(plan),
        explanation: "Der blev ikke fundet et tilstrækkeligt datagrundlag til den valgte kombination.",
        caveats: ["Små eller tomme udsnit returneres ikke som statistik."],
      });
    }

    const hasSalary = plan.metrics.some(metric => metric === "median_monthly_salary" || metric === "average_monthly_salary");
    let inflation: Awaited<ReturnType<typeof getAnnualCpi>> = [];
    let inflationUnavailable = false;
    if (hasSalary) {
      try {
        inflation = await getAnnualCpi();
        inflationUnavailable = inflation.length === 0;
      } catch {
        inflationUnavailable = true;
      }
    }
    const comparison = applyInflation(allSeries, inflation).map(row => ({ ...row, sampleBand: sampleSizeBand(row.memberCount) }));
    const visualization = buildStatisticsVisualization(comparison, plan.chart);
    await recordStatisticsAudit({
      orgId: caller.orgId, actorUserId: caller.userId, plan,
      suppressionCount: suppressedSegments + suppressedCells, pointCount: comparison.length,
      seriesCount: new Set(comparison.map(row => row.seriesKey)).size,
      policy: { minimumGroupSize: minimum, dominanceLimit, calculationVersion: STATISTICS_CALCULATION_VERSION },
      context: auditContext,
    });
    await finishAiUsageRun(runId, "succeeded");
    const caveats = [
      ...(comparison.some(row => row.lowSample) ? [`Mindst ét datapunkt bygger på færre end ${minimum} forskellige personer og skal tolkes med forsigtighed.`] : []),
      ...(includeDrafts ? ["Kladdekontrakter indgår efter organisationens indstilling og kan indeholde endnu ikke kontrollerede data."] : []),
      ...(new Set(comparison.map(row => row.year)).size < 2 ? ["Resultatet dækker kun ét år og kan derfor ikke vise en udvikling over tid."] : []),
      ...(suppressedSegments ? [`${suppressedSegments} lille delgruppe er udeladt, fordi den ikke opfylder organisationens minimumsgrænse.`] : []),
      ...(suppressionReasons.minimum_count ? [`${suppressionReasons.minimum_count} datapunkt(er) er sløret, fordi de bygger på for få forskellige personer.`] : []),
      ...(suppressionReasons.dominance ? [`${suppressionReasons.dominance} økonomiske datapunkt(er) er sløret, fordi få producenter overstiger dominansgrænsen på ${Math.round(dominanceLimit * 100)} %.`] : []),
      ...(suppressionReasons.secondary ? [`${suppressionReasons.secondary} datapunkt(er) er sekundært sløret for at forhindre bagudregning.`] : []),
      ...(autoSelectedProducers.length
        ? [`Producenterne er automatisk valgt fra de ${AUTO_PRODUCER_LIMIT} højest lønnede producentgrupper, der opfylder minimumskravet. Producentnavne er ikke anonymiserede, men løntal pr. producent vises stadig kun, når gruppen har mindst ${minimum} forskellige personer.`]
        : []),
      ...describeOmittedStatisticsPoints(omittedData),
      ...(comparison.some(row => (row.outlierExcludedCount ?? 0) > 0) ? ["Åbenlyse løn-afvigere er frasorteret før beregning af løn- og bidragstal."] : []),
      ...(inflationUnavailable ? ["Inflationsdata er midlertidigt utilgængelige. Løntallene vises derfor nominelt uden inflationskorrektion."] : []),
    ];
    return NextResponse.json({
      suppressed: false,
      minimum,
      minimumGroupSize: minimum,
      dominanceLimit,
      calculationVersion: STATISTICS_CALCULATION_VERSION,
      plan,
      interpretedBy,
      understoodAs: describeStatisticsPlan(plan),
      chart: plan.chart,
      includeDrafts,
      lowSample: comparison.some(row => row.lowSample),
      suppressionCount: suppressedSegments + suppressedCells,
      suppressionReasons,
      omittedData,
      series: comparison,
      visualization,
      metricMeta: plan.metrics.map(metric => ({ metric, ...STATISTICS_METRIC_META[metric] })),
      caveats,
      explanation: `${comparison.length} aggregerede datapunkter i ${new Set(comparison.map(row => row.seriesKey)).size} serie(r). Hvert person-gennemsnit vægter én gang i løn-, pensions- og arbejdsugeberegninger.`,
    });
  } catch (error) {
    const failure = classifyStatisticsQueryError(error);
    await finishAiUsageRun(runId, "failed", failure.errorCode);
    console.error("[statistics-query] Forespørgslen fejlede", { category: failure.errorCode });
    return NextResponse.json({
      error: "Forespørgslen kunne ikke gennemføres",
      reason: failure.reason,
      suggestion: failure.suggestion,
      code: failure.errorCode,
    }, { status: failure.status });
  }
}
