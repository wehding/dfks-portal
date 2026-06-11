"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

export async function addWorkForMember(params: {
  rightsHolderId: string;
  role: string;
  workData: {
    dfi_id?: string;
    tmdb_id?: number;
    title: string;
    type: string;
    year: number | null;
    description?: string | null;
    poster_url?: string | null;
  };
}) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: orgRole } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  const orgId = orgRole?.org_id ?? DFKS_ORG_ID;

  // Find eksisterende værk
  let workId: string | null = null;
  if (params.workData.dfi_id) {
    const { data } = await db.from("works").select("id").eq("dfi_id", params.workData.dfi_id).maybeSingle();
    if (data) workId = data.id;
  }
  if (!workId && params.workData.tmdb_id) {
    const { data } = await db.from("works").select("id").eq("tmdb_id", params.workData.tmdb_id).maybeSingle();
    if (data) workId = data.id;
  }

  // Opret nyt værk hvis ikke fundet
  if (!workId) {
    const { data: nw, error } = await db
      .from("works")
      .insert({ org_id: orgId, ...params.workData })
      .select("id")
      .single();
    if (error || !nw) return { success: false, error: error?.message ?? "Kunne ikke oprette værk" };
    workId = nw.id;
  }

  // Kobl rettighedshaver
  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      { work_id: workId, org_id: orgId, rights_holder_id: params.rightsHolderId, role: params.role },
      { onConflict: "work_id,rights_holder_id,role" }
    );
  if (assignErr) return { success: false, error: assignErr.message };

  // Hent det oprettede assignment
  const { data: fresh } = await db
    .from("work_assignments")
    .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
    .eq("work_id", workId)
    .eq("rights_holder_id", params.rightsHolderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { success: true, assignment: fresh };
}

export async function removeWorkAssignment(assignmentId: string) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  await db.from("work_assignments").delete().eq("id", assignmentId).eq("rights_holder_id", rh.id);
  return { success: true };
}
