"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgId } from "@/lib/org";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { ensureMemberCollaborationReviews } from "@/lib/server/work-collaboration-reviews";
import { sendMemberNotification } from "@/lib/member-notifications";
import { collaborationReviewStatusForSoloClaim } from "@/lib/work-collaboration-review";

async function ownContext(rightsHolderId: string) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new Error("Du skal være logget ind.");
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,user_id").eq("id", rightsHolderId).maybeSingle();
  if (!holder || holder.user_id !== user.id) throw new Error("Du kan kun gennemgå dine egne værker.");
  return { db, user, holder, orgId: await requireOrgId(db, user.id) };
}

export async function fetchMemberCollaborationReviews(params: { rightsHolderId: string }) {
  const { db, holder, orgId } = await ownContext(params.rightsHolderId);
  await ensureMemberCollaborationReviews(db, { orgId, rightsHolderId: holder.id });
  const { data: reviews, error } = await db.from("member_work_collaboration_reviews")
    .select("id,work_id,status,known_coeditor_count_at_response,reviewed_at,works(id,title,type,parent_work_id,season_number,episode_number)")
    .eq("org_id", orgId)
    .eq("rights_holder_id", holder.id)
    .order("created_at");
  if (error) return { success: false as const, error: error.message, reviews: [] };
  const workIds = (reviews ?? []).map(review => review.work_id);
  const { data: assignments } = workIds.length ? await db.from("work_assignments")
    .select("work_id,rights_holder_id")
    .eq("org_id", orgId)
    .in("work_id", workIds)
    .not("rights_holder_id", "is", null) : { data: [] };
  const otherCounts = new Map<string, Set<string>>();
  for (const assignment of assignments ?? []) {
    if (!assignment.rights_holder_id || assignment.rights_holder_id === holder.id) continue;
    const holders = otherCounts.get(assignment.work_id) ?? new Set<string>();
    holders.add(assignment.rights_holder_id);
    otherCounts.set(assignment.work_id, holders);
  }
  return {
    success: true as const,
    reviews: (reviews ?? []).map(review => ({
      ...review,
      currentCoeditorCount: otherCounts.get(review.work_id)?.size ?? 0,
    })),
  };
}

export async function confirmNoCoeditors(params: { rightsHolderId: string; workIds: string[]; source: "member_bulk" | "member_editor" }) {
  const { db, user, holder, orgId } = await ownContext(params.rightsHolderId);
  const workIds = [...new Set(params.workIds)].slice(0, 200);
  if (!workIds.length) return { success: false as const, error: "Vælg mindst ét værk eller afsnit." };
  await ensureMemberCollaborationReviews(db, { orgId, rightsHolderId: holder.id });
  const { data: ownAssignments } = await db.from("work_assignments").select("work_id")
    .eq("org_id", orgId).eq("rights_holder_id", holder.id).in("work_id", workIds);
  const ownedIds = new Set((ownAssignments ?? []).map(row => row.work_id));
  if (workIds.some(workId => !ownedIds.has(workId))) return { success: false as const, error: "Du kan kun gennemgå egne værker." };
  const { data: allAssignments } = await db.from("work_assignments").select("work_id,rights_holder_id")
    .eq("org_id", orgId).in("work_id", workIds).not("rights_holder_id", "is", null);
  const othersByWork = new Map<string, Set<string>>();
  for (const assignment of allAssignments ?? []) {
    if (!assignment.rights_holder_id || assignment.rights_holder_id === holder.id) continue;
    const set = othersByWork.get(assignment.work_id) ?? new Set<string>();
    set.add(assignment.rights_holder_id);
    othersByWork.set(assignment.work_id, set);
  }
  const now = new Date().toISOString();
  for (const workId of workIds) {
    const conflictCount = othersByWork.get(workId)?.size ?? 0;
    const { error } = await db.from("member_work_collaboration_reviews").update({
      status: collaborationReviewStatusForSoloClaim(conflictCount),
      source: params.source,
      known_coeditor_count_at_response: conflictCount,
      reviewed_by_user_id: user.id,
      reviewed_at: now,
      dispute_note: conflictCount ? "Medlemmet har oplyst, at værket eller afsnittet blev klippet alene, selv om andre rettighedshavere er registreret." : null,
      resolved_by_user_id: null,
      resolved_at: null,
      updated_at: now,
    }).eq("org_id", orgId).eq("rights_holder_id", holder.id).eq("work_id", workId);
    if (error) return { success: false as const, error: error.message };
  }
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true as const, confirmed: workIds.length - [...othersByWork.keys()].length, disputed: [...othersByWork.keys()].length };
}

export async function fetchAdminCollaborationDisputes() {
  const session = await createClient();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data, error } = await db.from("member_work_collaboration_reviews")
    .select("id,work_id,rights_holder_id,dispute_note,reviewed_at,works(title,season_number,episode_number),rettighedshavere(full_name)")
    .eq("org_id", admin.orgId).eq("status", "disputed").order("reviewed_at");
  if (error) throw new Error(error.message);
  return { success: true as const, disputes: data ?? [] };
}

export async function resolveCollaborationDispute(params: { reviewId: string; decision: "accept_solo" | "reopen" }) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin || !user) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: review } = await db.from("member_work_collaboration_reviews")
    .select("id,work_id,rights_holder_id,status").eq("id", params.reviewId).eq("org_id", admin.orgId).maybeSingle();
  if (!review || review.status !== "disputed") throw new Error("Indsigelsen findes ikke.");
  if (params.decision === "accept_solo") {
    const { count } = await db.from("work_assignments").select("id", { count: "exact", head: true })
      .eq("org_id", admin.orgId).eq("work_id", review.work_id).neq("rights_holder_id", review.rights_holder_id);
    if (count) throw new Error("Fjern eller ret først de modstridende klippertildelinger i værksadministrationen.");
  }
  const now = new Date().toISOString();
  const status = params.decision === "accept_solo" ? "solo_confirmed" : "pending";
  const { error } = await db.from("member_work_collaboration_reviews").update({
    status,
    source: "admin_resolution",
    dispute_note: params.decision === "accept_solo" ? null : "DFKS har bedt medlemmet gennemgå medklipperne igen.",
    resolved_by_user_id: user.id,
    resolved_at: now,
    updated_at: now,
  }).eq("id", review.id);
  if (error) throw new Error(error.message);
  if (params.decision === "reopen") {
    await sendMemberNotification({
      eventKey: `collaboration-review-reopened:${review.id}:${now}`,
      eventType: "collaboration_review_reopened",
      orgId: admin.orgId,
      rightsHolderId: review.rights_holder_id,
      category: "transactional",
      subject: "Gennemgå medklippere på et værk igen",
      bodyText: "DFKS har gennemgået din oplysning og beder dig åbne Mine værker, tilføje medklippere og angive dit eget foreløbige procentbud.",
      path: "/portal/mine-vaerker?collaborationReview=1",
      entityType: "member_work_collaboration_review",
      entityId: review.id,
    });
  }
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}
