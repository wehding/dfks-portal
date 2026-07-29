import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getAdminStatistics } from "@/lib/admin-statistics";

export const dynamic = "force-dynamic";

const ALLOWED_GENDERS = new Set(["male", "female", "other"]);
const ALLOWED_CATEGORIES = new Set(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const ALLOWED_CONTRACT_TYPES = new Set(["a-løn", "leverandør"]);

export async function GET(req: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  const params = req.nextUrl.searchParams;
  const yearValue = params.get("year");
  const year = yearValue && /^\d{4}$/.test(yearValue) ? Number(yearValue) : null;
  const gender = ALLOWED_GENDERS.has(params.get("gender") ?? "") ? params.get("gender") : null;
  const category = ALLOWED_CATEGORIES.has(params.get("category") ?? "") ? params.get("category") : null;
  const contractType = ALLOWED_CONTRACT_TYPES.has(params.get("contractType") ?? "") ? params.get("contractType") : null;
  const producerId = /^[0-9a-f-]{36}$/i.test(params.get("producerId") ?? "") ? params.get("producerId") : null;
  const professionType = params.get("professionType")?.trim().slice(0, 120) || null;
  try {
    const data = await getAdminStatistics(caller.orgId, { year, gender, category, contractType, producerId, professionType });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[admin-statistics] Aggregation failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Statistikken kunne ikke beregnes" }, { status: 500 });
  }
}
