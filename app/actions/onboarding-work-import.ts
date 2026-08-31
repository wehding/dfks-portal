"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgId } from "@/lib/org";
import type { OnboardingCredit } from "@/app/actions/dfi";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export type OnboardingImportStatus = {
  id: string;
  status: "queued" | "processing" | "complete" | "partial" | "error";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentTitle: string | null;
  errorMessage: string | null;
};

type JobRow = {
  id: string;
  status: OnboardingImportStatus["status"];
  total_items: number;
  completed_items: number;
  failed_items: number;
  current_title: string | null;
  error_message: string | null;
};

function toStatus(job: JobRow): OnboardingImportStatus {
  return {
    id: job.id,
    status: job.status,
    totalItems: Number(job.total_items),
    completedItems: Number(job.completed_items),
    failedItems: Number(job.failed_items),
    currentTitle: job.current_title,
    errorMessage: job.error_message,
  };
}

function itemKey(credit: OnboardingCredit) {
  return createHash("sha256").update(JSON.stringify({
    id: credit.id,
    season: credit.season_number ?? null,
    episodes: [...(credit.selected_episodes ?? [])].sort((a, b) => a - b),
  })).digest("hex");
}

async function currentImportOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Du skal være logget ind.");
  const db = createServiceClient();
  const { data: holder, error } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (error || !holder) throw new Error(error?.message ?? "Rettighedshaverprofilen blev ikke fundet.");
  return { supabase, db, userId: user.id, rightsHolderId: String(holder.id), orgId: await requireOrgId(db, user.id) };
}

export async function startOnboardingWorkImport(
  dfiPersonId: number | null,
  tmdbPersonId: number | null,
  approvedCredits: OnboardingCredit[]
) {
  try {
    if (!Array.isArray(approvedCredits) || approvedCredits.length === 0) {
      return { success: false as const, error: "Vælg mindst ét værk." };
    }
    const owner = await currentImportOwner();
    const rows = approvedCredits.map((credit, position) => {
      const serialized = JSON.stringify(credit);
      if (serialized.length > 2_000_000) throw new Error(`${credit.title}: værkdata er for store til importkøen.`);
      return {
        item_key: itemKey(credit),
        position,
        title: String(credit.title || "Ukendt titel").slice(0, 500),
        payload: JSON.parse(serialized) as OnboardingCredit,
      };
    });

    const { data: existing } = await owner.db.from("onboarding_work_import_jobs")
      .select("id,status,total_items,completed_items,failed_items,current_title,error_message")
      .eq("user_id", owner.userId).in("status", ["queued", "processing"]).order("created_at", { ascending: false }).limit(1).maybeSingle();

    let job = existing as JobRow | null;
    if (!job) {
      const inserted = await owner.db.from("onboarding_work_import_jobs").insert({
        user_id: owner.userId,
        rights_holder_id: owner.rightsHolderId,
        org_id: owner.orgId,
        dfi_person_id: dfiPersonId,
        tmdb_person_id: tmdbPersonId,
      }).select("id,status,total_items,completed_items,failed_items,current_title,error_message").single();
      if (inserted.error || !inserted.data) {
        if (inserted.error?.code !== "23505") throw new Error(inserted.error?.message ?? "Importjobbet kunne ikke oprettes.");
        const raced = await owner.db.from("onboarding_work_import_jobs")
          .select("id,status,total_items,completed_items,failed_items,current_title,error_message")
          .eq("user_id", owner.userId).in("status", ["queued", "processing"]).limit(1).single();
        if (raced.error || !raced.data) throw new Error(raced.error?.message ?? "Importjobbet kunne ikke genfindes.");
        job = raced.data as JobRow;
      } else {
        job = inserted.data as JobRow;
      }
    }

    const { error: itemError } = await owner.db.from("onboarding_work_import_items").upsert(
      rows.map(row => ({ ...row, job_id: job!.id })),
      { onConflict: "job_id,item_key", ignoreDuplicates: true }
    );
    if (itemError) throw new Error(itemError.message);

    const { count, error: countError } = await owner.db.from("onboarding_work_import_items")
      .select("id", { count: "exact", head: true }).eq("job_id", job.id);
    if (countError) throw new Error(countError.message);
    const { data: updated, error: updateError } = await owner.db.from("onboarding_work_import_jobs")
      .update({ total_items: count ?? rows.length, dfi_person_id: dfiPersonId, tmdb_person_id: tmdbPersonId, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .select("id,status,total_items,completed_items,failed_items,current_title,error_message").single();
    if (updateError || !updated) throw new Error(updateError?.message ?? "Importjobbet kunne ikke opdateres.");
    await recordSensitiveFlow({ actor: { userId: owner.userId, orgId: owner.orgId, role: "member", source: "portal" }, action: "import", component: "portal.onboarding.work-import", entityType: "onboarding_work_import_jobs", entityId: updated.id, targetMemberUuid: owner.rightsHolderId, orgIds: [owner.orgId], purposeCode: "member_work_onboarding", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["identity_data", "work_data", "union_membership_data"], counts: { requested: rows.length } });
    return { success: true as const, job: toStatus(updated as JobRow) };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Importjobbet kunne ikke oprettes." };
  }
}

export async function getOnboardingWorkImportStatus(jobId?: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "Ikke autoriseret" };
  let query = supabase.from("onboarding_work_import_jobs")
    .select("id,status,total_items,completed_items,failed_items,current_title,error_message")
    .eq("user_id", user.id);
  query = jobId ? query.eq("id", jobId) : query.in("status", ["queued", "processing"]).order("created_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) return { success: false as const, error: "Importstatus kunne ikke hentes." };
  return { success: true as const, job: data ? toStatus(data as JobRow) : null };
}

export async function retryOnboardingWorkImport(jobId: string) {
  try {
    const owner = await currentImportOwner();
    const { data: job, error } = await owner.supabase.from("onboarding_work_import_jobs")
      .select("id,status").eq("id", jobId).eq("user_id", owner.userId).maybeSingle();
    if (error || !job) throw new Error("Importjobbet blev ikke fundet.");
    if (!(["partial", "error"] as string[]).includes(job.status)) return { success: true as const, jobId };
    const now = new Date().toISOString();
    const { error: itemError } = await owner.db.from("onboarding_work_import_items")
      .update({ status: "queued", attempts: 0, error_message: null, locked_at: null, updated_at: now })
      .eq("job_id", jobId).eq("status", "error");
    if (itemError) throw new Error(itemError.message);
    const { error: jobError } = await owner.db.from("onboarding_work_import_jobs")
      .update({ status: "queued", failed_items: 0, error_message: null, completed_at: null, updated_at: now })
      .eq("id", jobId).eq("user_id", owner.userId);
    if (jobError) throw new Error(jobError.message);
    await recordSensitiveFlow({ actor: { userId: owner.userId, orgId: owner.orgId, role: "member", source: "portal" }, action: "import", component: "portal.onboarding.work-import-retry", entityType: "onboarding_work_import_jobs", entityId: jobId, targetMemberUuid: owner.rightsHolderId, orgIds: [owner.orgId], purposeCode: "member_work_onboarding", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["identity_data", "work_data", "union_membership_data"] });
    return { success: true as const, jobId };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Importen kunne ikke genoptages." };
  }
}
