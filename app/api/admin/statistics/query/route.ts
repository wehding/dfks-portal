import { NextRequest, NextResponse } from "next/server";
import { AiProviderHttpError, callAi } from "@/lib/ai-client";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import { createAiUsageRun, finishAiUsageRun } from "@/lib/ai-usage";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getAdminStatistics, type StatisticsFilters } from "@/lib/admin-statistics";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { extractStatisticsSeries, parseStatisticsQueryPlan, predefinedStatisticsQueryPlan, STATISTICS_QUERY_PLAN_SCHEMA, StatisticsQueryPlanError, type StatisticsCategory } from "@/lib/statistics-query-plan";
import { createServiceClient } from "@/lib/supabase/service";
import { getAnnualCpi } from "@/lib/statistics-cpi";
import { companyMatchScore, normalizeCompanyBaseName, type ProductionCompanyOption } from "@/lib/production-companies";

const SYSTEM = `Du oversætter danske statistikspørgsmål til en lukket JSON-plan.
Returnér kun JSON med: metric, groupBy, filters, chart.
metric må kun være average_monthly_salary, average_pension, average_working_weeks, contract_count eller contributions.
Spørgsmål om medianløn bruger average_monthly_salary; statistikmotoren returnerer den personvægtede median.
groupBy skal være year. chart må være line, bar eller table.
filters må kun indeholde years, yearFrom, yearTo, gender, categories, contractType, producerNames, producerTypeCodes, membershipTypes, professionType og experienceGroup.
Ved en periode som "siden 2022" sættes yearFrom til 2022 og yearTo til ${new Date().getFullYear()}. Ved et enkelt år bruges years. Brug null for en manglende periodegrænse.
experienceGroup må være new_graduate (0-3 år), early_career (4-7 år), experienced (8-17 år), veteran (18+ år) eller null. Erfaring beregnes i kontraktens år.
years, categories, producerNames, producerTypeCodes og membershipTypes er arrays.
Brug tomme arrays eller null for filtre, der ikke fremgår. Højst fem producenter.
Spillefilm er category feature og dokumentarfilm er category documentary.
Medlem er membershipType member, tilknyttet medlem er associate og ikke medlem er none.
Forsøg aldrig at identificere personer og skriv aldrig SQL.`;

type ProducerCandidate = { id: string; name: string; score: number };

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

function categoryLabel(category: StatisticsCategory) {
  return category === "feature" ? "Spillefilm" : category === "documentary" ? "Dokumentarfilm" : category;
}

function classifyStatisticsQueryError(error: unknown) {
  if (error instanceof StatisticsQueryPlanError) return {
    status: 422,
    errorCode: error.code,
    reason: error.code === "unsupported_metric"
      ? "Spørgsmålet handler om et mål, som den sikre statistikmotor endnu ikke understøtter."
      : error.code === "unsupported_grouping"
        ? "Spørgsmålet kræver en gruppering, som statistikmotoren endnu ikke understøtter."
        : "Spørgsmålet indeholdt ikke nok oplysninger til at vælge et sikkert statistikmål.",
    suggestion: "Spørg fx til løn, pension, arbejdsuger, antal kontrakter eller producentbidrag fordelt på år.",
  } as const;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof AiProviderHttpError && error.failureClass === "input") {
    return {
      status: 500,
      errorCode: "ai_request_invalid",
      reason: "Statistikassistentens modelopsætning kunne ikke bruges til forespørgslen.",
      suggestion: "En administrator kan kontrollere modelvalget og statistikfunktionen i AI-kontrolrummet.",
    } as const;
  }
  if (error instanceof AiProviderHttpError || error instanceof SyntaxError || /api-nøgle|ukendt ai-udbyder|timeout|fetch failed/.test(message)) {
    return {
      status: 503,
      errorCode: error instanceof SyntaxError ? "ai_invalid_response" : error instanceof AiProviderHttpError ? `ai_${error.failureClass}` : "ai_unavailable",
      reason: "Statistikassistenten er midlertidigt utilgængelig.",
      suggestion: "Prøv igen om lidt. Hvis fejlen fortsætter, kan en administrator kontrollere modellen i AI-kontrolrummet.",
    } as const;
  }
  return {
    status: 500,
    errorCode: "statistics_data_error",
    reason: "Statistikgrundlaget kunne ikke beregnes lige nu.",
    suggestion: "Prøv igen. Hvis fejlen fortsætter, skal databasefunktionen kontrolleres af en administrator.",
  } as const;
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (question.length < 5) return NextResponse.json({ error: "Skriv et statistikspørgsmål." }, { status: 400 });

  const runId = await createAiUsageRun({
    orgId: caller.orgId,
    operationType: "statistics_query",
    entityType: "statistics_query",
    actorUserId: caller.userId,
    source: "admin",
  });
  try {
    const predefinedPlan = predefinedStatisticsQueryPlan(question);
    let response: string | null = null;
    if (!predefinedPlan) {
      const runtime = await getAiRuntimeConfig("statistics_query");
      response = await callAi({
        provider: runtime.provider,
        model: runtime.model,
        system: SYSTEM,
        userMessage: question,
        maxTokens: 700,
        responseJson: true,
        responseSchema: STATISTICS_QUERY_PLAN_SCHEMA,
        promptCaching: runtime.promptCachingEnabled,
        usageContext: { runId, orgId: caller.orgId, useCase: "statistics_query", stage: "query" },
      });
    }
    const jsonText = response?.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const plan = predefinedPlan ?? parseStatisticsQueryPlan(JSON.parse(jsonText ?? ""));
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
        code: "ambiguous_producer",
        query: producers.ambiguous.query,
        candidates: producers.ambiguous.candidates,
      }, { status: 409 });
    }

    const producerDimensions = producers.resolved.length ? producers.resolved : [{ id: "", name: "" }];
    const categoryDimensions = plan.filters.categories.length > 1
      ? plan.filters.categories.map(category => ({ category, label: categoryLabel(category) }))
      : [{ category: plan.filters.categories[0] ?? null, label: "" }];
    const allSeries: ReturnType<typeof extractStatisticsSeries> = [];
    let minimum = 5;
    let includeDrafts = false;
    for (const producer of producerDimensions) {
      for (const category of categoryDimensions) {
        const filters: StatisticsFilters = {
          years: plan.filters.years,
          gender: plan.filters.gender,
          categories: category.category ? [category.category] : [],
          contractType: plan.filters.contractType,
          producerIds: producer.id ? [producer.id] : [],
          producerTypeCodes: plan.filters.producerTypeCodes,
          membershipTypes: plan.filters.membershipTypes,
          professionType: plan.filters.professionType,
          experienceGroup: plan.filters.experienceGroup,
        };
        const statistics = await getAdminStatistics(caller.orgId, filters);
        minimum = statistics.minimum;
        includeDrafts ||= Boolean(statistics.includeDrafts);
        if (statistics.suppressed) continue;
        const label = [producer.name, category.label].filter(Boolean).join(" · ") || "Resultat";
        const key = [producer.id, category.category].filter(Boolean).join(":") || "result";
        allSeries.push(...extractStatisticsSeries(plan, statistics as unknown as Record<string, unknown>, key, label));
      }
    }

    if (!allSeries.length) {
      await finishAiUsageRun(runId, "succeeded");
      return NextResponse.json({
        suppressed: true,
        minimum,
        plan,
        explanation: "Der blev ikke fundet et tilstrækkeligt datagrundlag til den valgte kombination.",
        caveats: ["Små eller tomme udsnit returneres ikke som statistik."],
      });
    }
    let inflation: Awaited<ReturnType<typeof getAnnualCpi>> = [];
    let inflationUnavailable = false;
    if (plan.metric === "average_monthly_salary") {
      try {
        inflation = await getAnnualCpi();
        inflationUnavailable = inflation.length === 0;
      } catch {
        inflationUnavailable = true;
      }
    }
    const inflationMap = new Map(inflation.map(row => [row.year, row.index]));
    const bySeries = new Map<string, typeof allSeries>();
    for (const row of allSeries) bySeries.set(row.seriesKey, [...(bySeries.get(row.seriesKey) ?? []), row]);
    const comparison = [...bySeries.values()].flatMap(rows => {
      const sorted = [...rows].sort((left, right) => left.year - right.year);
      const baseline = sorted.find(row => inflationMap.has(row.year));
      return sorted.map(row => {
        if (plan.metric !== "average_monthly_salary" || !baseline) return row;
        const baseIndex = inflationMap.get(baseline.year);
        const currentIndex = inflationMap.get(row.year);
        const inflationAdjustedBaseline = baseIndex && currentIndex ? baseline.value * currentIndex / baseIndex : null;
        return { ...row, inflationIndex: currentIndex ?? null, realChangePercent: inflationAdjustedBaseline ? Math.round((row.value / inflationAdjustedBaseline - 1) * 1000) / 10 : null };
      });
    });
    await finishAiUsageRun(runId, "succeeded");
    const caveats = [
      ...(comparison.some(row => row.lowSample) ? ["Mindst ét datapunkt bygger på færre end fem forskellige personer og skal tolkes med forsigtighed."] : []),
      ...(includeDrafts ? ["Kladdekontrakter indgår efter organisationens indstilling og kan indeholde endnu ikke kontrollerede data."] : []),
      ...(new Set(comparison.map(row => row.year)).size < 2 ? ["Resultatet dækker kun ét år og kan derfor ikke vise en udvikling over tid."] : []),
      ...(inflationUnavailable ? ["Inflationsdata er midlertidigt utilgængelige. Løntallene vises derfor nominelt uden inflationskorrektion."] : []),
    ];
    return NextResponse.json({
      suppressed: false,
      minimum,
      plan,
      chart: plan.chart,
      includeDrafts,
      lowSample: comparison.some(row => row.lowSample),
      series: comparison,
      caveats,
      explanation: `${comparison.length} aggregerede datapunkter blev fundet. Resultater med 1–4 forskellige personer er markeret som statistisk usikre.${includeDrafts ? " Kladder indgår efter organisationens indstilling." : ""}`,
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
