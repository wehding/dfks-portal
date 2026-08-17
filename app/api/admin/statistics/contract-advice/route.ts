import { NextRequest, NextResponse } from "next/server";

import { requireStaffModuleApi } from "@/lib/api-auth";
import { getContractAdviceStatistics } from "@/lib/contract-advice-statistics";

export const dynamic = "force-dynamic";

function values(params: URLSearchParams, key: string, pattern: RegExp, maximum = 20) {
  return [...new Set(params.getAll(key).flatMap(value => value.split(","))
    .map(value => value.trim()).filter(value => pattern.test(value)))].slice(0, maximum);
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffModuleApi("advice_statistics", "read");
  if (!auth.ok) return auth.response;
  const params = request.nextUrl.searchParams;
  const years = values(params, "year", /^\d{4}$/, 100).map(Number);
  try {
    const data = await getContractAdviceStatistics(auth.orgId, {
      years,
      contractTypes: values(params, "contractType", /^[a-zA-Z0-9æøåÆØÅ_\- ]{1,80}$/),
      productionTypes: values(params, "productionType", /^[a-zA-Z0-9æøåÆØÅ_\- ]{1,80}$/),
      intakeSources: values(params, "source", /^[a-z_\-]{1,40}$/),
      ruleCodes: values(params, "rule", /^[a-z0-9_\-]{1,80}$/),
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[contract-advice-statistics] Aggregation failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Rådgivningsstatistikken kunne ikke beregnes" }, { status: 500 });
  }
}
