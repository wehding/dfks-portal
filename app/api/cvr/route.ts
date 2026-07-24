import { NextRequest, NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { apiCvrNameMatchScore, formatApiCvrAddress, fuzzySearchApiCvr, lookupApiCvr } from "@/lib/api-cvr-mcp";

export async function GET(req: NextRequest) {
  const auth = await requireSessionApi();
  if (!auth.ok) return auth.response;

  const cvr = req.nextUrl.searchParams.get("cvr")?.replace(/\D/g, "") ?? "";
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    if (cvr) {
      if (!/^\d{7,8}$/.test(cvr)) {
        return NextResponse.json({ error: "Ugyldigt CVR-nummer" }, { status: 400 });
      }
      const company = await lookupApiCvr(cvr);
      if (!company) return NextResponse.json({ error: "CVR-nummer ikke fundet" }, { status: 404 });
      return NextResponse.json({
        navn: company.name,
        legalName: company.name,
        registrationNumber: company.cvrNumber,
        address: formatApiCvrAddress(company),
        contactPhone: company.phone,
        contactEmail: company.email,
        website: company.website,
        status: company.status,
        companyType: company.companyType,
        industryCode: company.industryCode,
        industryDescription: company.industryDescription,
        startDate: company.startDate,
        endDate: company.endDate,
        employees: company.employees,
      });
    }

    if (query.length < 2) {
      return NextResponse.json({ error: "Skriv mindst 2 tegn eller et CVR-nummer" }, { status: 400 });
    }
    if (/^\d{7,8}$/.test(query.replace(/\D/g, "")) && !/[a-zæøå]/i.test(query)) {
      const normalized = query.replace(/\D/g, "");
      const company = await lookupApiCvr(normalized);
      return NextResponse.json({ results: company ? [{
        name: company.name,
        cvrNumber: company.cvrNumber,
        industryCode: company.industryCode,
        industryDescription: company.industryDescription,
      }] : [] });
    }

    const results = await fuzzySearchApiCvr(query);
    return NextResponse.json({
      results: results
        .map(result => ({ ...result, score: apiCvrNameMatchScore(result.name, query) }))
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "da"))
        .slice(0, 15),
    });
  } catch (error) {
    console.error("[apiCVR] Opslag fejlede", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "CVR-opslag fejlede" }, { status: 502 });
  }
}
