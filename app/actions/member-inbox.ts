"use server";

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { requireOrgId } from "@/lib/org";
import { sendMemberNotification } from "@/lib/member-notifications";
import { addMemberContractComment, addAdminContractComment, markContractCommentsRead } from "@/app/actions/member-contracts";
import { addScreeningClaimComment, markScreeningClaimCommentsRead } from "@/app/actions/screenings";
import { addAdminWorkRequestComment, markWorkRequestCommentsRead } from "@/app/actions/work-management";
import { calculateThreadResponseState } from "@/lib/admin-dashboard";
import type { AdminMessageThread } from "@/lib/admin-message-threads";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

// De sammensatte tråd-id'er fra fetchMemberInbox/fetchAdminInbox: "contract-<uuid>" og
// "screening-<uuid>" peger IKKE på member_message_threads. Denne helper afkoder kilden, så
// svar/læsemarkering kan route til den rette tabel i stedet for at slå fejl.
type InboxThreadRef =
  | { kind: "direct"; id: string }
  | { kind: "contract"; id: string }
  | { kind: "work"; id: string }
  | { kind: "review"; id: string }
  | { kind: "screening"; id: string };

function parseInboxThreadId(threadId: string): InboxThreadRef {
  if (threadId.startsWith("contract-")) return { kind: "contract", id: threadId.slice("contract-".length) };
  if (threadId.startsWith("work-")) return { kind: "work", id: threadId.slice("work-".length) };
  if (threadId.startsWith("review-")) return { kind: "review", id: threadId.slice("review-".length) };
  if (threadId.startsWith("screening-")) return { kind: "screening", id: threadId.slice("screening-".length) };
  return { kind: "direct", id: threadId };
}

async function signedInUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function decorateAdminThread(
  thread: Omit<AdminMessageThread, "requiresReply" | "waitingSince">,
): AdminMessageThread {
  const state = calculateThreadResponseState(thread.member_messages.map(message => ({
    role: message.author_role === "member" ? "member" as const : "staff" as const,
    createdAt: message.created_at,
  })));
  return { ...thread, ...state };
}

async function loadAdminWorkThreads(
  db: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<AdminMessageThread[]> {
  const { data: workRequests, error } = await db.from("work_change_requests")
    .select("id,work_id,requested_by_rights_holder_id,status,created_at,reviewed_at,works(title),rettighedshavere(full_name,email),work_change_request_comments(id,author_user_id,author_role,message,created_at,admin_read_at)")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);

  return (workRequests ?? []).map(request => {
    const storedComments = [...((request.work_change_request_comments ?? []) as Array<{
      id: string;
      author_user_id: string;
      author_role: "member" | "admin";
      message: string;
      created_at: string;
      admin_read_at: string | null;
    }>)]
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
    const memberMessages: AdminMessageThread["member_messages"] = [
      {
        id: `work-request-${request.id}`,
        author_user_id: "",
        author_role: "member" as const,
        body: "Der er indsendt en rettelse til værket.",
        created_at: request.created_at,
      },
      ...storedComments.map(comment => ({
        id: comment.id,
        author_user_id: comment.author_user_id,
        author_role: comment.author_role,
        body: comment.message,
        created_at: comment.created_at,
      })),
    ];
    if (request.status !== "pending" && request.reviewed_at) {
      memberMessages.push({
        id: `work-reviewed-${request.id}`,
        author_user_id: "",
        author_role: "admin",
        body: "Værksanmodningen er behandlet.",
        created_at: request.reviewed_at,
      });
    }
    memberMessages.sort((left, right) => left.created_at.localeCompare(right.created_at));
    const work = Array.isArray(request.works) ? request.works[0] : request.works;
    const holder = Array.isArray(request.rettighedshavere) ? request.rettighedshavere[0] : request.rettighedshavere;
    const contextTitle = `Værk: ${work?.title ?? "Rettelse"}`;
    return decorateAdminThread({
      id: `work-${request.id}`,
      source_type: "work",
      category_label: "Værk",
      context_title: contextTitle,
      subject: `Værkbesked: ${work?.title ?? "Rettelse"}`,
      updated_at: memberMessages.at(-1)?.created_at ?? request.created_at,
      created_at: memberMessages[0]?.created_at ?? request.created_at,
      rettighedshavere: holder ?? null,
      member_messages: memberMessages,
      unreadCount: storedComments.filter(comment => comment.author_role === "member" && !comment.admin_read_at).length,
      can_reply: true,
      action_href: `/admin/vaerker?request=${encodeURIComponent(request.id)}`,
      workId: request.work_id,
      requestId: request.id,
    });
  });
}

// Sørger for at medlemmet har organisationens velkomstbesked liggende som første
// tråd i indbakken. Kører idempotent (kolonne-lås på welcome_message_sent_at).
async function ensureWelcomeThread(db: ReturnType<typeof createServiceClient>, params: { holderId: string; memberUserId: string; orgId: string }) {
  try {
    const { data: holder } = await db.from("rettighedshavere")
      .select("welcome_message_sent_at").eq("id", params.holderId).maybeSingle();
    if (!holder || holder.welcome_message_sent_at) return;

    const { data: org } = await db.from("organisations")
      .select("welcome_message_text, branding").eq("id", params.orgId).maybeSingle();
    const welcomeText = (org?.welcome_message_text ?? "").trim();
    if (!welcomeText) return;

    // Lås rækken, så parallelle kald ikke opretter dubletter.
    const { data: claimed } = await db.from("rettighedshavere")
      .update({ welcome_message_sent_at: new Date().toISOString() })
      .eq("id", params.holderId)
      .is("welcome_message_sent_at", null)
      .select("id");
    if (!claimed?.length) return;

    // Afsender: en admin i organisationen — fallback: medlemmet selv (vises altid som organisationen).
    const { data: adminRole } = await db.from("user_org_roles")
      .select("user_id").eq("org_id", params.orgId)
      .in("role", ["superadmin", "admin", "org-admin"]).limit(1).maybeSingle();
    const senderId = adminRole?.user_id ?? params.memberUserId;

    const shortName = ((org?.branding as { short_name?: string } | null)?.short_name ?? "DFKS").trim() || "DFKS";
    const { data: thread } = await db.from("member_message_threads")
      .insert({ org_id: params.orgId, rights_holder_id: params.holderId, subject: `Velkommen til ${shortName}-portalen`, created_by: senderId })
      .select("id").single();
    if (!thread) return;
    const { data: message } = await db.from("member_messages")
      .insert({ thread_id: thread.id, author_user_id: senderId, author_role: "admin", body: welcomeText })
      .select("id").single();
    if (!message) { await db.from("member_message_threads").delete().eq("id", thread.id); return; }
    // Medlemmets deltager-række skal altid have last_read_at=null, så velkomsten fremstår ulæst —
    // også når der ikke er en admin, og medlemmet selv står som (tekniske) afsender.
    const memberParticipant = { thread_id: thread.id, user_id: params.memberUserId, last_read_at: null };
    const participants = senderId === params.memberUserId
      ? [memberParticipant]
      : [{ thread_id: thread.id, user_id: senderId, last_read_at: new Date().toISOString() }, memberParticipant];
    await db.from("member_message_participants").insert(participants);
  } catch (error) {
    console.error("[inbox] Velkomstbesked kunne ikke oprettes:", error);
  }
}

export async function fetchMemberInbox() {
  const { user } = await signedInUser();
  if (!user) return { success: false, error: "Ikke logget ind", threads: [] };
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,full_name,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  if (!holder) return { success: false, error: "Medlemsprofilen findes ikke", threads: [] };
  const orgId = (Array.isArray(holder.org_affiliations) ? holder.org_affiliations[0] : holder.org_affiliations)?.org_id;
  if (!orgId) return { success: false, error: "Medlemsprofilen er ikke knyttet til en organisation", threads: [] };
  await ensureWelcomeThread(db, { holderId: holder.id, memberUserId: user.id, orgId });

  // 1. Direkte beskeder
  const { data: directThreads, error } = await db.from("member_message_threads")
    .select("id,subject,updated_at,created_at,member_messages(id,author_user_id,author_role,created_at),member_message_participants(user_id,last_read_at)")
    .eq("org_id", orgId).eq("rights_holder_id", holder.id).order("updated_at", { ascending: false });
  if (error) return { success: false, error: error.message, threads: [] };

  const unifiedThreads: any[] = (directThreads ?? []).map(t => ({
    ...t,
    source_type: "direct",
    category_label: "Generelt",
    context_title: t.subject,
  }));

  // 2. Kontraktkommentarer
  const { data: memberContracts } = await db.from("contracts")
    .select("id,working_title,work_id,works(title),contract_comments(id,author_user_id,author_role,created_at,member_read_at)")
    .eq("org_id", orgId).eq("rights_holder_id", holder.id);
  
  (memberContracts ?? []).forEach(c => {
    const comments = (c.contract_comments ?? []) as any[];
    if (!comments.length) return;
    const worksRel = (c as any).works;
    const workTitle = (Array.isArray(worksRel) ? worksRel[0]?.title : worksRel?.title) || c.working_title || "Kontrakt";
    const lastComment = comments.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const unread = comments.some(m => m.author_role === "admin" && !m.member_read_at);
    unifiedThreads.push({
      id: `contract-${c.id}`,
      contract_id: c.id,
      source_type: "contract",
      category_label: "Kontrakt",
      context_title: `Kontrakt: ${workTitle}`,
      subject: `Kontraktbesked: ${workTitle}`,
      updated_at: lastComment?.created_at || c.id,
      created_at: comments[0]?.created_at || c.id,
      member_messages: comments.map(m => ({
        id: m.id,
        author_user_id: m.author_user_id,
        author_role: m.author_role,
        created_at: m.created_at,
      })),
      member_message_participants: [{ user_id: user.id, last_read_at: unread ? null : new Date().toISOString() }],
    });
  });

  // 3. Visningsindberetninger
  const { data: claims } = await db.from("screening_claims")
    .select("id,title,channel,screening_date,screening_claim_comments(id,author_user_id,author_role,created_at,member_read_at)")
    .eq("profile_id", user.id);

  (claims ?? []).forEach(sc => {
    const comments = (sc.screening_claim_comments ?? []) as any[];
    if (!comments.length) return;
    const lastComment = comments.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const unread = comments.some(m => m.author_role === "admin" && !m.member_read_at);
    unifiedThreads.push({
      id: `screening-${sc.id}`,
      screening_claim_id: sc.id,
      source_type: "screening",
      category_label: "Visning",
      context_title: `Visning: ${sc.title} (${sc.channel || ""})`,
      subject: `Visningsbesked: ${sc.title}`,
      updated_at: lastComment?.created_at || sc.id,
      created_at: comments[0]?.created_at || sc.id,
      member_messages: comments.map(m => ({
        id: m.id,
        author_user_id: m.author_user_id,
        author_role: m.author_role,
        created_at: m.created_at,
      })),
      member_message_participants: [{ user_id: user.id, last_read_at: unread ? null : new Date().toISOString() }],
    });
  });

  unifiedThreads.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  await recordSensitiveFlow({
    actor: { userId: user.id, orgId, role: "member", source: "portal" }, action: "read",
    component: "portal.member_inbox", entityType: "message_thread", targetMemberUuid: holder.id,
    purposeCode: "member_communication", legalBasis: "gdpr_art_6_1_b",
    dataCategories: ["message_data", "contract_data", "screening_data"], counts: { threads: unifiedThreads.length },
  });
  return { success: true, threads: unifiedThreads };
}

export async function fetchMemberInboxThread(threadId: string) {
  const { user } = await signedInUser();
  if (!user) return { success: false, error: "Ikke logget ind", messages: [] };
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  const orgId = (Array.isArray(holder?.org_affiliations) ? holder.org_affiliations[0] : holder?.org_affiliations)?.org_id;
  if (!holder || !orgId) return { success: false, error: "Medlemsprofilen findes ikke", messages: [] };
  const ref = parseInboxThreadId(threadId);
  if (ref.kind === "direct") {
    const { data: thread, error } = await db.from("member_message_threads")
      .select("member_messages(id,author_role,body,created_at)")
      .eq("id", ref.id).eq("org_id", orgId).eq("rights_holder_id", holder.id).maybeSingle();
    if (error || !thread) return { success: false, error: "Beskedtråden blev ikke fundet", messages: [] };
    return { success: true, messages: thread.member_messages ?? [] };
  }
  if (ref.kind === "contract") {
    const { data: contract } = await db.from("contracts")
      .select("contract_comments(id,author_role,message,created_at)")
      .eq("id", ref.id).eq("org_id", orgId).eq("rights_holder_id", holder.id).maybeSingle();
    if (!contract) return { success: false, error: "Kontrakttråden blev ikke fundet", messages: [] };
    return { success: true, messages: (contract.contract_comments ?? []).map(message => ({ id: message.id, author_role: message.author_role, body: message.message, created_at: message.created_at })) };
  }
  if (ref.kind === "screening") {
    const { data: claim } = await db.from("screening_claims")
      .select("screening_claim_comments(id,author_role,message,created_at)")
      .eq("id", ref.id).eq("profile_id", user.id).maybeSingle();
    if (!claim) return { success: false, error: "Visningstråden blev ikke fundet", messages: [] };
    return { success: true, messages: (claim.screening_claim_comments ?? []).map(message => ({ id: message.id, author_role: message.author_role, body: message.message, created_at: message.created_at })) };
  }
  return { success: false, error: "Beskedtypen understøttes ikke", messages: [] };
}

export async function fetchAdminInbox() {
  const { supabase, user } = await signedInUser();
  if (!user || !(await assertAdminRole(supabase))) return { success: false, error: "Mangler adminrettigheder", threads: [] };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);

  const { data: directThreads, error } = await db.from("member_message_threads")
    .select("id,subject,updated_at,created_at,rights_holder_id,rettighedshavere(full_name,email),member_messages(id,author_user_id,author_role,body,created_at),member_message_participants(user_id,last_read_at)")
    .eq("org_id", orgId).order("updated_at", { ascending: false });
  if (error) return { success: false, error: error.message, threads: [] };

  const unifiedThreads: AdminMessageThread[] = (directThreads ?? []).map(thread => {
    const participant = (thread.member_message_participants ?? []).find(row => row.user_id === user.id);
    const lastReadAt = participant?.last_read_at ?? "";
    const messages = (thread.member_messages ?? []).map(message => ({
      id: message.id,
      author_user_id: message.author_user_id,
      author_role: message.author_role as "member" | "admin",
      body: message.body,
      created_at: message.created_at,
    }));
    return decorateAdminThread({
      id: thread.id,
      source_type: "direct",
      subject: thread.subject,
      category_label: "Generelt",
      context_title: thread.subject,
      updated_at: thread.updated_at,
      created_at: thread.created_at,
      rettighedshavere: Array.isArray(thread.rettighedshavere) ? thread.rettighedshavere[0] ?? null : thread.rettighedshavere,
      member_messages: messages,
      unreadCount: messages.filter(message => message.author_role === "member" && message.created_at > lastReadAt).length,
      can_reply: true,
      action_href: null,
    });
  });

  // Kontraktkommentarer for admin
  const { data: adminContracts } = await db.from("contracts")
    .select("id,working_title,rights_holder_id,rettighedshavere(full_name,email),contract_comments(id,author_user_id,author_role,message,created_at,admin_read_at)")
    .eq("org_id", orgId);

  (adminContracts ?? []).forEach(c => {
    const comments = (c.contract_comments ?? []) as any[];
    if (!comments.length) return;
    const workTitle = c.working_title || "Kontrakt";
    const lastComment = comments.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const rh = Array.isArray(c.rettighedshavere) ? c.rettighedshavere[0] : c.rettighedshavere;
    unifiedThreads.push(decorateAdminThread({
      id: `contract-${c.id}`,
      source_type: "contract",
      category_label: "Kontrakt",
      context_title: `Kontrakt: ${workTitle}`,
      subject: `Kontraktbesked: ${workTitle}`,
      rettighedshavere: rh,
      updated_at: lastComment?.created_at || c.id,
      created_at: comments[0]?.created_at || c.id,
      member_messages: comments.map(m => ({
        id: m.id,
        author_user_id: m.author_user_id,
        author_role: m.author_role,
        body: m.message,
        created_at: m.created_at,
      })),
      unreadCount: comments.filter(m => m.author_role === "member" && !m.admin_read_at).length,
      can_reply: true,
      action_href: `/admin/kontrakter?contract=${encodeURIComponent(c.id)}`,
    }));
  });

  const [workThreads, { data: claims }, { data: reviews }] = await Promise.all([
    loadAdminWorkThreads(db, orgId),
    db.from("screening_claims")
      .select("id,profile_id,title,channel,status,created_at,reviewed_at,screening_claim_comments(id,author_user_id,author_role,message,created_at,admin_read_at)")
      .eq("org_id", orgId),
    db.from("contract_reviews")
      .select("id,member_name,member_email,file_name,notes,status,reviewed_at,updated_at,jurist_response,jurist_response_at")
      .eq("org_id", orgId),
  ]);

  unifiedThreads.push(...workThreads);

  const profileIds = [...new Set((claims ?? []).map(claim => claim.profile_id))];
  const { data: screeningHolders } = profileIds.length
    ? await db.from("rettighedshavere").select("user_id,full_name,email").in("user_id", profileIds)
    : { data: [] as any[] };
  const holderByUserId = new Map((screeningHolders ?? []).map(holder => [holder.user_id, holder]));
  for (const claim of claims ?? []) {
    const comments = [{ id: `screening-request-${claim.id}`, author_user_id: "", author_role: "member", message: "Der er indsendt en visningsindberetning.", created_at: claim.created_at }, ...((claim.screening_claim_comments ?? []) as any[])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (claim.status !== "pending" && claim.reviewed_at) {
      comments.push({ id: `screening-reviewed-${claim.id}`, author_user_id: "", author_role: "admin", message: "Visningsindberetningen er behandlet.", created_at: claim.reviewed_at });
      comments.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    unifiedThreads.push(decorateAdminThread({
      id: `screening-${claim.id}`, source_type: "screening", category_label: "Visning", context_title: `Visning: ${claim.title}${claim.channel ? ` · ${claim.channel}` : ""}`,
      subject: `Visningsbesked: ${claim.title}`, updated_at: comments.at(-1)?.created_at ?? claim.created_at,
      created_at: comments[0]?.created_at ?? claim.created_at, rettighedshavere: holderByUserId.get(claim.profile_id) ?? null, can_reply: true,
      member_messages: comments.map(message => ({ ...message, body: message.message })),
      unreadCount: ((claim.screening_claim_comments ?? []) as any[]).filter(message => message.author_role === "member" && !message.admin_read_at).length,
      action_href: `/admin/aftalelicens?claim=${encodeURIComponent(claim.id)}`,
    }));
  }

  for (const review of reviews ?? []) {
    const messages: AdminMessageThread["member_messages"] = [{ id: `review-request-${review.id}`, author_user_id: "", author_role: "member", body: review.notes || "Kontrakten afventer juridisk gennemgang.", created_at: review.reviewed_at }];
    if (review.jurist_response_at) messages.push({ id: `review-response-${review.id}`, author_user_id: "", author_role: "admin", body: review.jurist_response || "Gennemgangen er besvaret.", created_at: review.jurist_response_at });
    else if (!["afventer", "behandling"].includes(review.status) && review.updated_at) messages.push({ id: `review-closed-${review.id}`, author_user_id: "", author_role: "admin", body: "Kontraktgennemgangen er afsluttet.", created_at: review.updated_at });
    unifiedThreads.push(decorateAdminThread({
      id: `review-${review.id}`, source_type: "review", category_label: "Kontraktgennemgang", context_title: review.file_name || "Kontraktgennemgang",
      subject: review.file_name || "Kontraktgennemgang", updated_at: review.jurist_response_at || review.reviewed_at, created_at: review.reviewed_at,
      rettighedshavere: { full_name: review.member_name || "Medlem", email: review.member_email }, member_messages: messages,
      unreadCount: 0, can_reply: false, action_href: `/admin/kontraktgennemgang/${review.id}`,
    }));
  }

  unifiedThreads.sort((a, b) => Number(b.requiresReply) - Number(a.requiresReply) || (a.requiresReply
    ? String(a.waitingSince).localeCompare(String(b.waitingSince))
    : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
  return { success: true, threads: unifiedThreads };
}

export async function fetchAdminWorkInbox() {
  const { supabase, user } = await signedInUser();
  if (!user || !(await assertAdminRole(supabase))) {
    return { success: false, error: "Mangler adminrettigheder", threads: [] as AdminMessageThread[] };
  }
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  try {
    const threads = (await loadAdminWorkThreads(db, orgId))
      .filter(thread => thread.unreadCount > 0)
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
    return { success: true, threads };
  } catch (error) {
    console.error("[admin-work-inbox] Værksbeskeder kunne ikke hentes", {
      error: error instanceof Error ? error.message : "ukendt fejl",
    });
    return {
      success: false,
      error: "Værksbeskederne kunne ikke hentes. Prøv igen.",
      threads: [] as AdminMessageThread[],
    };
  }
}

export async function fetchAdminInboxRecipients() {
  const { supabase, user } = await signedInUser();
  if (!user || !(await assertAdminRole(supabase))) return { success: false, error: "Mangler adminrettigheder", recipients: [] };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  const { data, error } = await db.from("rettighedshavere")
    .select("id,full_name,email,user_id,org_affiliations!inner(org_id)")
    .eq("org_affiliations.org_id", orgId)
    .not("user_id", "is", null)
    .order("full_name");
  return error ? { success: false, error: error.message, recipients: [] } : { success: true, recipients: data ?? [] };
}

export async function createAdminInboxMessage(params: { rightsHolderIds: string[]; subject: string; body: string }) {
  const { supabase, user } = await signedInUser();
  if (!user || !(await assertAdminRole(supabase))) return { success: false, error: "Mangler adminrettigheder" };
  const subject = params.subject.trim().slice(0, 200);
  const body = params.body.trim().slice(0, 10000);
  const ids = [...new Set(params.rightsHolderIds)];
  if (!subject || !body || !ids.length) return { success: false, error: "Vælg modtagere og udfyld emne og besked." };
  if (ids.length > 500) return { success: false, error: "Der kan højst vælges 500 modtagere ad gangen." };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  const { data: holders, error: holderError } = await db.from("rettighedshavere").select("id,user_id,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", orgId).in("id", ids);
  if (holderError || !holders?.length) return { success: false, error: holderError?.message ?? "Ingen gyldige modtagere" };
  const eligibleHolders = holders.filter(holder => holder.user_id);
  const skippedWithoutPortalUser = holders.length - eligibleHolders.length;
  if (!eligibleHolders.length) return { success: false, error: "Ingen af de valgte medlemmer har en portalbruger" };
  const isBroadcast = eligibleHolders.length > 1;
  let campaignId: string | null = null;
  if (isBroadcast) {
    const { data: campaign, error } = await db.from("message_campaigns").insert({ org_id: orgId, subject, body, created_by: user.id, recipient_count: eligibleHolders.length }).select("id").single();
    if (error || !campaign) return { success: false, error: error?.message ?? "Kampagnen kunne ikke oprettes" };
    campaignId = campaign.id;
  }
  let created = 0;
  for (const holder of eligibleHolders) {
    const { data: thread, error: threadError } = await db.from("member_message_threads").insert({ org_id: orgId, rights_holder_id: holder.id, subject, campaign_id: campaignId, created_by: user.id }).select("id").single();
    if (threadError || !thread) continue;
    const { data: message, error: messageError } = await db.from("member_messages").insert({ thread_id: thread.id, author_user_id: user.id, author_role: "admin", body }).select("id").single();
    if (messageError || !message) { await db.from("member_message_threads").delete().eq("id", thread.id); continue; }
    const participants = [{ thread_id: thread.id, user_id: user.id, last_read_at: new Date().toISOString() }, ...(holder.user_id ? [{ thread_id: thread.id, user_id: holder.user_id, last_read_at: null }] : [])];
    await db.from("member_message_participants").insert(participants);
    created += 1;
    try {
      await sendMemberNotification({ eventKey: `inbox-message:${message.id}`, eventType: isBroadcast ? "broadcast_message" : "direct_message", orgId, rightsHolderId: holder.id, category: isBroadcast ? "broadcast" : "transactional", subject, bodyText: body, path: `/portal?thread=${thread.id}`, entityType: "message_thread", entityId: thread.id });
    } catch (notificationError) {
      console.error("[notification] indbakkemail kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/admin/beskeder");
  revalidatePath("/portal");
  return { success: created > 0, count: created, skippedWithoutPortalUser, error: created ? undefined : "Ingen beskeder blev oprettet" };
}

export async function sendInboxReply(threadId: string, bodyValue: string) {
  const { supabase, user } = await signedInUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const body = bodyValue.trim().slice(0, 10000);
  if (!body) return { success: false, error: "Skriv en besked." };

  // Kontrakt-/visningstråde svares via deres egne kommentar-tabeller (ikke member_messages).
  const ref = parseInboxThreadId(threadId);
  if (ref.kind === "contract") {
    const isAdmin = Boolean(await assertAdminRole(supabase));
    const res = isAdmin
      ? await addAdminContractComment(ref.id, body)
      : await addMemberContractComment(ref.id, body);
    return res.success ? { success: true } : { success: false, error: res.error };
  }
  if (ref.kind === "screening") {
    const isAdmin = Boolean(await assertAdminRole(supabase));
    const res = await addScreeningClaimComment({ claimId: ref.id, message: body, authorRole: isAdmin ? "admin" : "member" });
    return res.success ? { success: true } : { success: false, error: res.error };
  }
  if (ref.kind === "work") {
    const isAdmin = Boolean(await assertAdminRole(supabase));
    if (!isAdmin) return { success: false, error: "Værksbeskeder besvares fra værksformularen." };
    try {
      await addAdminWorkRequestComment({ requestId: ref.id, message: body });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Beskeden kunne ikke sendes" };
    }
  }
  if (ref.kind === "review") return { success: false, error: "Åbn kontraktgennemgangen for at behandle den." };

  const db = createServiceClient();
  const { data: thread } = await db.from("member_message_threads").select("id,org_id,rights_holder_id").eq("id", ref.id).maybeSingle();
  if (!thread) return { success: false, error: "Tråden findes ikke" };
  const { data: holder } = await db.from("rettighedshavere").select("id,user_id").eq("id", thread.rights_holder_id).maybeSingle();
  const admin = await assertAdminRole(supabase);
  if ((!admin && holder?.user_id !== user.id) || (admin && await requireOrgId(db, user.id) !== thread.org_id)) return { success: false, error: "Ikke autoriseret" };
  const role = admin ? "admin" : "member";
  const { data: message, error } = await db.from("member_messages").insert({ thread_id: threadId, author_user_id: user.id, author_role: role, body }).select("id,author_user_id,author_role,body,created_at").single();
  if (error || !message) return { success: false, error: error?.message ?? "Beskeden kunne ikke gemmes" };
  await Promise.all([
    db.from("member_message_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId),
    db.from("member_message_participants").upsert({ thread_id: threadId, user_id: user.id, last_read_at: new Date().toISOString() }),
  ]);
  revalidatePath("/admin/beskeder"); revalidatePath("/portal");
  return { success: true, message };
}

export async function markInboxThreadRead(threadId: string) {
  const { supabase, user } = await signedInUser();
  if (!user) return { success: false };

  const ref = parseInboxThreadId(threadId);
  if (ref.kind === "contract" || ref.kind === "screening" || ref.kind === "work") {
    const isAdmin = Boolean(await assertAdminRole(supabase));
    const viewerRole = isAdmin ? "admin" : "member";
    const res = ref.kind === "contract"
      ? await markContractCommentsRead(ref.id, viewerRole)
      : ref.kind === "screening"
        ? await markScreeningClaimCommentsRead(ref.id, viewerRole)
        : await markWorkRequestCommentsRead(ref.id, viewerRole);
    return { success: Boolean(res?.success) };
  }
  if (ref.kind === "review") return { success: true };

  const db = createServiceClient();
  const { data: thread } = await db.from("member_message_threads").select("id,org_id,rights_holder_id").eq("id", ref.id).maybeSingle();
  if (!thread) return { success: false };
  const { data: holder } = await db.from("rettighedshavere").select("user_id").eq("id", thread.rights_holder_id).maybeSingle();
  const { data: role } = await db.from("user_org_roles").select("id").eq("user_id", user.id).eq("org_id", thread.org_id).limit(1).maybeSingle();
  if (holder?.user_id !== user.id && !role) return { success: false };
  await db.from("member_message_participants").upsert({ thread_id: threadId, user_id: user.id, last_read_at: new Date().toISOString() });
  return { success: true };
}
