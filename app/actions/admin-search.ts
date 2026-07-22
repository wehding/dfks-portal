"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { requireOrgId } from "@/lib/org";

export type AdminSearchResult = { id: string; type: "rightsHolder" | "work" | "contract" | "producer"; title: string; context: string; href: string };

function escapedLike(query: string) {
  return query.replace(/[\\%_]/g, value => `\\${value}`);
}

export async function searchAdmin(queryValue: string): Promise<{ success: boolean; results: AdminSearchResult[]; error?: string }> {
  const query = queryValue.trim();
  if (query.length < 2 || query.length > 100) return { success: false, results: [], error: "Søgningen skal være mellem 2 og 100 tegn." };
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user || !(await assertAdminRole(session))) return { success: false, results: [], error: "Ikke autoriseret" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  const pattern = `%${escapedLike(query)}%`;
  const { data: producerLinks } = await db.from("contracts").select("employer_id").eq("org_id", orgId).not("employer_id", "is", null);
  const producerIds = [...new Set((producerLinks ?? []).map(row => row.employer_id).filter((id): id is string => Boolean(id)))];
  const [holders, works, contracts, producers] = await Promise.all([
    db.from("rettighedshavere").select("id,full_name,email,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", orgId).ilike("full_name", pattern).limit(5),
    db.from("works").select("id,title,year").eq("org_id", orgId).ilike("title", pattern).limit(5),
    db.from("contracts").select("id,working_title,type").eq("org_id", orgId).ilike("working_title", pattern).limit(5),
    db.from("employers").select("id,name").in("id", producerIds.length ? producerIds : ["00000000-0000-0000-0000-000000000000"]).ilike("name", pattern).limit(5),
  ]);
  const firstError = [holders.error, works.error, contracts.error, producers.error].find(Boolean);
  if (firstError) return { success: false, results: [], error: "Søgningen kunne ikke gennemføres." };
  const results: AdminSearchResult[] = [
    ...(holders.data ?? []).map(row => ({ id: row.id, type: "rightsHolder" as const, title: row.full_name, context: row.email ?? "Rettighedshaver", href: `/admin/rettighedshavere?search=${encodeURIComponent(row.full_name)}` })),
    ...(works.data ?? []).map(row => ({ id: row.id, type: "work" as const, title: row.title, context: row.year ? `Værk · ${row.year}` : "Værk", href: `/admin/vaerker?edit=${row.id}` })),
    ...(contracts.data ?? []).map(row => ({ id: row.id, type: "contract" as const, title: row.working_title ?? "Kontrakt uden titel", context: row.type ?? "Kontrakt", href: `/admin/kontrakter?edit=${row.id}` })),
    ...(producers.data ?? []).map(row => ({ id: row.id, type: "producer" as const, title: row.name, context: "Producent", href: `/admin/producenter?search=${encodeURIComponent(row.name)}` })),
  ];
  return { success: true, results };
}
