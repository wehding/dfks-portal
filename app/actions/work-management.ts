"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

type WorkCorrectionData = {
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  description: string | null;
};

const CORRECTABLE_KEYS: (keyof WorkCorrectionData)[] = [
  "title",
  "type",
  "year",
  "duration_minutes",
  "episode_count",
  "genre",
  "description",
];

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeData(data: WorkCorrectionData): WorkCorrectionData {
  return {
    title: data.title.trim(),
    type: data.type.trim(),
    year: data.year,
    duration_minutes: data.duration_minutes,
    episode_count: data.episode_count,
    genre: cleanText(data.genre),
    description: cleanText(data.description),
  };
}

function changedFields(current: Record<string, unknown>, proposed: WorkCorrectionData) {
  return CORRECTABLE_KEYS.reduce<Partial<WorkCorrectionData>>((acc, key) => {
    const next = proposed[key];
    const prev = current[key];
    if ((next ?? null) !== (prev ?? null)) acc[key] = next as never;
    return acc;
  }, {});
}

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Du skal være logget ind.");
  return { supabase, user: data.user };
}

export async function submitWorkDataCorrection(params: {
  assignmentId: string;
  workId: string;
  data: WorkCorrectionData;
  comment: string;
}) {
  const comment = params.comment.trim();
  if (!comment) throw new Error("Skriv en bemærkning til admin.");

  const proposed = normalizeData(params.data);
  if (!proposed.title) throw new Error("Titel må ikke være tom.");
  if (!proposed.type) throw new Error("Type må ikke være tom.");

  const { user } = await currentUser();
  const db = createServiceClient();

  const { data: assignment, error: assignmentError } = await db
    .from("work_assignments")
    .select("id, work_id, rights_holder_id, rettighedshavere(id,user_id)")
    .eq("id", params.assignmentId)
    .eq("work_id", params.workId)
    .single();

  if (assignmentError || !assignment) throw new Error("Kunne ikke finde din tilknytning til værket.");
  const rightsHolder = Array.isArray(assignment.rettighedshavere) ? assignment.rettighedshavere[0] : assignment.rettighedshavere;
  if (!rightsHolder || rightsHolder.user_id !== user.id) throw new Error("Du kan kun foreslå rettelser til dine egne værker.");

  const { data: work, error: workError } = await db
    .from("works")
    .select("id, org_id, title, type, year, duration_minutes, episode_count, genre, description, status")
    .eq("id", params.workId)
    .single();

  if (workError || !work) throw new Error("Værket findes ikke.");

  const proposedChanges = changedFields(work, proposed);
  if (!Object.keys(proposedChanges).length) throw new Error("Der er ingen ændringer at sende til admin.");

  const { data: request, error: requestError } = await db
    .from("work_change_requests")
    .insert({
      org_id: work.org_id ?? DFKS_ORG_ID,
      work_id: work.id,
      requested_by_user_id: user.id,
      requested_by_rights_holder_id: rightsHolder.id,
      source: "Mine værker",
      old_data: work,
      proposed_data: proposedChanges,
      status: "pending",
    })
    .select("id")
    .single();

  if (requestError || !request?.id) throw new Error(requestError?.message ?? "Kunne ikke oprette ændringsanmodning.");

  const { error: commentError } = await db.from("work_change_request_comments").insert({
    request_id: request.id,
    author_user_id: user.id,
    author_role: "member",
    message: comment,
  });
  if (commentError) throw new Error(commentError.message);

  const { error: statusError } = await db.from("works").update({ status: "til_godkendelse" }).eq("id", work.id);
  if (statusError) throw new Error(statusError.message);

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true, requestId: request.id as string };
}

export async function fetchAdminWorksForReview() {
  const { supabase } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const { data, error } = await db
    .from("works")
    .select("*, work_change_requests(*, rettighedshavere(full_name), work_change_request_comments(*))")
    .eq("org_id", DFKS_ORG_ID)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return { success: true, works: data ?? [] };
}

export async function reviewWorkDataCorrection(params: {
  requestId: string;
  decision: "approved" | "rejected";
  comment?: string;
}) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const { data: request, error: requestError } = await db
    .from("work_change_requests")
    .select("*")
    .eq("id", params.requestId)
    .single();

  if (requestError || !request) throw new Error(requestError?.message ?? "Anmodningen findes ikke.");
  if (request.status !== "pending") throw new Error("Anmodningen er allerede behandlet.");

  if (params.decision === "approved") {
    const proposed = request.proposed_data as Partial<WorkCorrectionData>;
    const allowed = CORRECTABLE_KEYS.reduce<Partial<WorkCorrectionData>>((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(proposed, key)) acc[key] = proposed[key] as never;
      return acc;
    }, {});
    const { error } = await db.from("works").update(allowed).eq("id", request.work_id);
    if (error) throw new Error(error.message);
  }

  const { error } = await db
    .from("work_change_requests")
    .update({
      status: params.decision,
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      admin_comment: cleanText(params.comment),
    })
    .eq("id", params.requestId);
  if (error) throw new Error(error.message);

  if (params.comment?.trim()) {
    const { error: commentError } = await db.from("work_change_request_comments").insert({
      request_id: params.requestId,
      author_user_id: user.id,
      author_role: "admin",
      message: params.comment.trim(),
    });
    if (commentError) throw new Error(commentError.message);
  }

  const { count } = await db
    .from("work_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("work_id", request.work_id)
    .eq("status", "pending");

  if (!count) await db.from("works").update({ status: "godkendt" }).eq("id", request.work_id);

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}
