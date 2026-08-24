import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { requireOrgId } from "@/lib/org";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await requireSessionApi();
  if (!auth.ok) return auth.response;

  const db = createServiceClient();
  const orgId = await requireOrgId(db, auth.userId).catch(() => null);
  if (!orgId) {
    return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation." }, { status: 403 });
  }

  const { data, error } = await db
    .from("org_affiliations")
    .select("rettighedshavere(id, full_name, archived_at)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[portal/rights-holders] lookup failed", error);
    return NextResponse.json({ error: "Rettighedshavere kunne ikke hentes." }, { status: 500 });
  }

  const results = (data ?? [])
    .map(row => Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere)
    .filter((holder): holder is { id: string; full_name: string; archived_at: string | null } => Boolean(holder?.id && holder.full_name && !holder.archived_at))
    .map(holder => ({ id: holder.id, full_name: holder.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "da", { sensitivity: "base" }));

  return NextResponse.json({ results });
}
