import { NextRequest, NextResponse } from "next/server";
import { callAi } from "@/lib/ai-client";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import { createAiUsageRun, finishAiUsageRun } from "@/lib/ai-usage";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getAdminStatistics } from "@/lib/admin-statistics";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { extractStatisticsSeries, parseStatisticsQueryPlan } from "@/lib/statistics-query-plan";
import { createServiceClient } from "@/lib/supabase/service";
import { getAnnualCpi } from "@/lib/statistics-cpi";

const SYSTEM = `Du oversætter danske statistikspørgsmål til en lukket JSON-plan.
Returnér kun JSON med: metric, groupBy, filters, chart.
metric må kun være average_monthly_salary, average_pension, average_working_weeks, contract_count eller contributions.
groupBy skal være year. chart må være line, bar eller table.
filters må kun indeholde year, gender, category, contractType, producerName og professionType.
Brug null for filtre, der ikke fremgår. Forsøg aldrig at identificere personer og skriv aldrig SQL.`;

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (question.length < 5) return NextResponse.json({ error: "Skriv et statistikspørgsmål." }, { status: 400 });

  const runtime = await getAiRuntimeConfig("statistics_query");
  const runId = await createAiUsageRun({
    orgId: caller.orgId,
    operationType: "statistics_query",
    entityType: "statistics_query",
    actorUserId: caller.userId,
    source: "admin",
  });
  try {
    const response = await callAi({
      provider: runtime.provider,
      model: runtime.model,
      system: SYSTEM,
      userMessage: question,
      maxTokens: 500,
      responseJson: true,
      promptCaching: runtime.promptCachingEnabled,
      usageContext: { runId, orgId: caller.orgId, useCase: "statistics_query", stage: "query" },
    });
    const jsonText = response.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const plan = parseStatisticsQueryPlan(JSON.parse(jsonText));
    let producerId: string | null = null;
    if (plan.filters.producerName) {
      const escaped = plan.filters.producerName.replaceAll("%", "\\%").replaceAll("_", "\\_");
      const { data: producer } = await createServiceClient().from("employers")
        .select("id,name").ilike("name", `%${escaped}%`).limit(1).maybeSingle();
      if (!producer) return NextResponse.json({ error: "Producenten blev ikke fundet i producentdatabasen." }, { status: 404 });
      producerId = producer.id as string;
    }
    const statistics = await getAdminStatistics(caller.orgId, { ...plan.filters, producerId });
    if (statistics.suppressed) {
      await finishAiUsageRun(runId, "succeeded");
      return NextResponse.json({ suppressed: true, minimum: statistics.minimum, plan });
    }
    const series = extractStatisticsSeries(plan, statistics as unknown as Record<string, unknown>);
    const inflation = await getAnnualCpi();
    const inflationMap = new Map(inflation.map(row => [row.year, row.index]));
    const baseline = series.find(row => inflationMap.has(row.year));
    const comparison = plan.metric === "average_monthly_salary" && baseline
      ? series.map(row => {
          const baseIndex = inflationMap.get(baseline.year);
          const currentIndex = inflationMap.get(row.year);
          const inflationAdjustedBaseline = baseIndex && currentIndex ? baseline.value * currentIndex / baseIndex : null;
          return { ...row, inflationIndex: currentIndex ?? null, realChangePercent: inflationAdjustedBaseline ? Math.round((row.value / inflationAdjustedBaseline - 1) * 1000) / 10 : null };
        })
      : series;
    await finishAiUsageRun(runId, "succeeded");
    return NextResponse.json({
      suppressed: false,
      minimum: statistics.minimum,
      plan,
      series: comparison,
      explanation: series.length
        ? `Resultatet viser ${series.length} anonymiserede årsgrupper. Hver gruppe indeholder mindst ${statistics.minimum} forskellige rettighedshavere.`
        : "Der blev ikke fundet anonymiserede data, som matcher spørgsmålet.",
    });
  } catch (error) {
    await finishAiUsageRun(runId, "failed", "invalid_query_plan");
    console.error("[statistics-query]", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Spørgsmålet kunne ikke omsættes til en sikker statistikforespørgsel." }, { status: 400 });
  }
}
