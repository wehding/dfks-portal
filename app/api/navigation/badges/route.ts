import { NextRequest, NextResponse } from "next/server";
import { readActiveOrgIdFromRequest } from "@/lib/active-org-context";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { normalizeNavigationBadgeCounts } from "@/lib/navigation-badges";
import { createRequestClient } from "@/lib/supabase/request-client";
import { verifyRequestUser } from "@/lib/supabase/request-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { countUniqueWorkShareTasks } from "@/lib/work-share-task-count";
import { isActionableAdminWorkShareCase } from "@/lib/work-share-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));

  const context = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request), auth.userId);
  if (!context) return applyAuthResponse(NextResponse.json({ error: "Ingen organisationsadgang" }, { status: 403 }));

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_navigation_badge_counts", {
    p_org_id: context.orgId,
    p_user_id: context.userId,
    p_rights_holder_id: context.rightsHolderId,
  });
  if (error) {
    console.error("[navigation-badges] rpc_failed", { code: error.code });
    return applyAuthResponse(NextResponse.json({ error: "Navigationstællere kunne ikke hentes" }, { status: 500 }));
  }
  const row = Array.isArray(data) ? data[0] : data;
  const [shareCases, collaborationDisputes, legacyDeclarationTasks] = await Promise.all([
    context.canUseAdmin
      ? db.from("work_share_cases").select("work_id,season_number,episode_number,work_share_participants(rights_holder_id,invited_by_rights_holder_id,source_tags,excluded_at)").eq("org_id", context.orgId).neq("status", "resolved")
      : Promise.resolve({ data: [], error: null }),
    context.canUseAdmin
      ? db.from("member_work_collaboration_reviews").select("work_id,works(season_number,episode_number)").eq("org_id", context.orgId).eq("status", "disputed")
      : Promise.resolve({ data: [], error: null }),
    context.canUseMember && context.rightsHolderId
      ? db.rpc("list_member_legacy_declaration_tasks", {
          p_org_id: context.orgId,
          p_rights_holder_id: context.rightsHolderId,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const taskError = shareCases.error ?? collaborationDisputes.error ?? legacyDeclarationTasks.error;
  if (taskError) {
    console.error("[navigation-badges] work_share_count_failed", { code: taskError.code });
    return applyAuthResponse(NextResponse.json({ error: "Navigationstællere kunne ikke hentes" }, { status: 500 }));
  }
  const taskReferences = (shareCases.data ?? []).filter(isActionableAdminWorkShareCase).map(item => ({
    work_id: item.work_id,
    season_number: item.season_number,
    episode_number: item.episode_number,
  }));
  for (const item of collaborationDisputes.data ?? []) {
    const work = item.works as unknown as { season_number?: number | null; episode_number?: number | null } | null;
    taskReferences.push({ work_id: item.work_id, season_number: work?.season_number, episode_number: work?.episode_number });
  }
  const workShareTaskCount = countUniqueWorkShareTasks(taskReferences);
  const badgeRow = {
    ...((row as Record<string, unknown> | null) ?? {}),
    // RPC'ens admin_works omfatter allerede arbejdsandelssager. De har deres
    // eget mærke og trækkes derfor ud af det almindelige værk-pendingtal.
    admin_works: Math.max(0, Number((row as Record<string, unknown> | null)?.admin_works ?? 0) - workShareTaskCount),
    admin_work_share_tasks: workShareTaskCount,
    member_work_review_todos:
      Number((row as Record<string, unknown> | null)?.member_work_review_todos ?? 0)
      + (legacyDeclarationTasks.data?.length ?? 0),
  };
  return applyAuthResponse(NextResponse.json(normalizeNavigationBadgeCounts(badgeRow)));
}
