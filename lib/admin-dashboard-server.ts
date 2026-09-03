import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AdminDashboardMetrics, ResponseEvent } from "@/lib/admin-dashboard";
import { calculateResponseTimeStats } from "@/lib/admin-dashboard";
import { isActionableAdminWorkShareCase } from "@/lib/work-share-admin";

export async function loadAdminDashboardMetrics(orgId: string, userId: string): Promise<AdminDashboardMetrics> {
  void userId;
  const db = createServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    drafts, validated, members, workRequests, workShareCases, workShareDisputes, screeningClaims, reviews,
    contractUnread, workUnread, screeningUnread,
    contractMessages, workMessages, screeningMessages, reviewRows, workRequestRows, screeningClaimRows,
  ] = await Promise.all([
    db.from("contracts").select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .not("work_id", "is", null)
      .neq("status", "valideret")
      .neq("status", "arkiveret"),
    db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "valideret"),
    db.from("org_affiliations").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_member", true),
    db.from("work_change_requests").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    db.from("work_share_cases").select("id,work_share_participants(rights_holder_id,invited_by_rights_holder_id,source_tags,excluded_at)").eq("org_id", orgId).neq("status", "resolved"),
    db.from("member_work_collaboration_reviews").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "disputed"),
    db.from("screening_claims").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    db.from("contract_reviews").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["afventer", "behandling"]),
    db.from("contract_comments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("work_change_request_comments").select("id,work_change_requests!inner(org_id)", { count: "exact", head: true }).eq("work_change_requests.org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("screening_claim_comments").select("id,screening_claims!inner(org_id)", { count: "exact", head: true }).eq("screening_claims.org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("contract_comments").select("id,contract_id,author_role,created_at").eq("org_id", orgId).gte("created_at", since).limit(1000),
    db.from("work_change_request_comments").select("id,request_id,author_role,created_at,work_change_requests!inner(org_id)").eq("work_change_requests.org_id", orgId).gte("created_at", since).limit(1000),
    db.from("screening_claim_comments").select("id,claim_id,author_role,created_at,screening_claims!inner(org_id)").eq("screening_claims.org_id", orgId).gte("created_at", since).limit(1000),
    db.from("contract_reviews").select("id,status,reviewed_at,updated_at,jurist_response_at").eq("org_id", orgId).gte("updated_at", since).limit(1000),
    db.from("work_change_requests").select("id,status,created_at,reviewed_at").eq("org_id", orgId).gte("created_at", since).limit(1000),
    db.from("screening_claims").select("id,status,created_at,reviewed_at").eq("org_id", orgId).gte("created_at", since).limit(1000),
  ]);

  const events: ResponseEvent[] = [];
  for (const row of contractMessages.data ?? []) events.push({ threadId: `contract-${row.contract_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });
  for (const row of workMessages.data ?? []) events.push({ threadId: `work-${row.request_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });
  for (const row of screeningMessages.data ?? []) events.push({ threadId: `screening-${row.claim_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });
  for (const row of workRequestRows.data ?? []) {
    events.push({ threadId: `work-${row.id}`, role: "member", createdAt: row.created_at });
    if (row.status !== "pending" && row.reviewed_at) events.push({ threadId: `work-${row.id}`, role: "staff", createdAt: row.reviewed_at });
  }
  for (const row of screeningClaimRows.data ?? []) {
    events.push({ threadId: `screening-${row.id}`, role: "member", createdAt: row.created_at });
    if (row.status !== "pending" && row.reviewed_at) events.push({ threadId: `screening-${row.id}`, role: "staff", createdAt: row.reviewed_at });
  }

  // Direkte medlemsbeskeder hentes af AdminInboxPanel efter første render. Dashboardet
  // må ikke blokere login ved at hente hele beskedhistorikken server-side.
  const inboxUnread = 0;
  for (const review of reviewRows.data ?? []) {
    events.push({ threadId: `review-${review.id}`, role: "member", createdAt: review.reviewed_at });
    if (review.jurist_response_at) events.push({ threadId: `review-${review.id}`, role: "staff", createdAt: review.jurist_response_at });
    else if (!["afventer", "behandling"].includes(review.status) && review.updated_at) events.push({ threadId: `review-${review.id}`, role: "staff", createdAt: review.updated_at });
  }

  return {
    tasks: {
      contractValidationsPending: drafts.count ?? 0,
      workRequests: workRequests.count ?? 0,
      workShareCases: (workShareCases.data ?? []).filter(isActionableAdminWorkShareCase).length + (workShareDisputes.count ?? 0),
      screeningClaims: screeningClaims.count ?? 0,
      contractReviews: reviews.count ?? 0,
    },
    messages: {
      contracts: contractUnread.count ?? 0,
      works: workUnread.count ?? 0,
      screenings: screeningUnread.count ?? 0,
      inbox: inboxUnread,
    },
    validatedContracts: validated.count ?? 0,
    members: members.count ?? 0,
    responseTimes: calculateResponseTimeStats(events, since),
  };
}
