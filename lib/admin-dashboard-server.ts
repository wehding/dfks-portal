import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AdminDashboardMetrics, ResponseEvent } from "@/lib/admin-dashboard";
import { calculateResponseTimeStats } from "@/lib/admin-dashboard";

type MessageRow = { id: string; author_role: string; created_at: string };

export async function loadAdminDashboardMetrics(orgId: string, userId: string): Promise<AdminDashboardMetrics> {
  const db = createServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    drafts, validated, members, workRequests, screeningClaims, reviews,
    contractUnread, workUnread, screeningUnread,
    contractMessages, workMessages, screeningMessages, directThreads, reviewRows,
  ] = await Promise.all([
    db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "kladde"),
    db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "valideret"),
    db.from("org_affiliations").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_member", true),
    db.from("work_change_requests").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    db.from("screening_claims").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
    db.from("contract_reviews").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["afventer", "behandling"]),
    db.from("contract_comments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("work_change_request_comments").select("id,work_change_requests!inner(org_id)", { count: "exact", head: true }).eq("work_change_requests.org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("screening_claim_comments").select("id,screening_claims!inner(org_id)", { count: "exact", head: true }).eq("screening_claims.org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
    db.from("contract_comments").select("id,contract_id,author_role,created_at").eq("org_id", orgId).gte("created_at", since),
    db.from("work_change_request_comments").select("id,request_id,author_role,created_at,work_change_requests!inner(org_id)").eq("work_change_requests.org_id", orgId).gte("created_at", since),
    db.from("screening_claim_comments").select("id,claim_id,author_role,created_at,screening_claims!inner(org_id)").eq("screening_claims.org_id", orgId).gte("created_at", since),
    db.from("member_message_threads").select("id,member_messages(id,author_role,created_at),member_message_participants(user_id,last_read_at)").eq("org_id", orgId),
    db.from("contract_reviews").select("id,reviewed_at,jurist_response_at").eq("org_id", orgId).gte("reviewed_at", since),
  ]);

  const events: ResponseEvent[] = [];
  for (const row of contractMessages.data ?? []) events.push({ threadId: `contract:${row.contract_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });
  for (const row of workMessages.data ?? []) events.push({ threadId: `work:${row.request_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });
  for (const row of screeningMessages.data ?? []) events.push({ threadId: `screening:${row.claim_id}`, role: row.author_role === "member" ? "member" : "staff", createdAt: row.created_at });

  let inboxUnread = 0;
  for (const thread of directThreads.data ?? []) {
    const messages = (thread.member_messages ?? []) as MessageRow[];
    const participant = (thread.member_message_participants ?? []).find((row: { user_id: string }) => row.user_id === userId) as { last_read_at: string | null } | undefined;
    const lastRead = participant?.last_read_at ?? "";
    inboxUnread += messages.filter(message => message.author_role === "member" && message.created_at > lastRead).length;
    for (const message of messages) {
      if (message.created_at < since) continue;
      events.push({ threadId: `inbox:${thread.id}`, role: message.author_role === "member" ? "member" : "staff", createdAt: message.created_at });
    }
  }
  for (const review of reviewRows.data ?? []) {
    events.push({ threadId: `review:${review.id}`, role: "member", createdAt: review.reviewed_at });
    if (review.jurist_response_at) events.push({ threadId: `review:${review.id}`, role: "staff", createdAt: review.jurist_response_at });
  }

  return {
    tasks: {
      contractDrafts: drafts.count ?? 0,
      workRequests: workRequests.count ?? 0,
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
    responseTimes: calculateResponseTimeStats(events),
  };
}
