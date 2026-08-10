import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getAdminStatistics } from "@/lib/admin-statistics";
import { isExperienceGroup } from "@/lib/experience-groups";

export const dynamic = "force-dynamic";

const ALLOWED_GENDERS = new Set(["male", "female", "other"]);
const ALLOWED_CATEGORIES = new Set(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const ALLOWED_CONTRACT_TYPES = new Set(["a-løn", "leverandør"]);

export async function GET(req: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen statistikadgang" }, { status: 403 });
  const params = req.nextUrl.searchParams;
  const years = params.getAll("year").flatMap(value => value.split(","))
    .filter(value => /^\d{4}$/.test(value)).map(Number)
    .filter((value, index, all) => all.indexOf(value) === index).slice(0, 200);
  const gender = ALLOWED_GENDERS.has(params.get("gender") ?? "") ? params.get("gender") : null;
  const categories = params.getAll("category").flatMap(value => value.split(","))
    .filter(value => ALLOWED_CATEGORIES.has(value))
    .filter((value, index, all) => all.indexOf(value) === index);
  const contractType = ALLOWED_CONTRACT_TYPES.has(params.get("contractType") ?? "") ? params.get("contractType") : null;
  const producerIds = params.getAll("producerId").filter(value => /^[0-9a-f-]{36}$/i.test(value)).slice(0, 5);
  const producerTypeCodes = params.getAll("producerType").filter(value => /^[a-z0-9_]{2,80}$/.test(value)).slice(0, 20);
  const membershipTypes = params.getAll("membership").filter(value => ["member", "associate", "unknown", "none"].includes(value)).slice(0, 4);
  const professionType = params.get("professionType")?.trim().slice(0, 120) || null;
  const experienceGroupValue = params.get("experienceGroup");
  const experienceGroup = isExperienceGroup(experienceGroupValue) ? experienceGroupValue : null;
  try {
    const data = await getAdminStatistics(caller.orgId, { years, gender, categories, contractType, producerIds, producerTypeCodes, membershipTypes, professionType, experienceGroup });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[admin-statistics] Aggregation failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Statistikken kunne ikke beregnes" }, { status: 500 });
  }
}
