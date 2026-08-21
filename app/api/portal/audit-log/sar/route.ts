import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  dateFrom: z.string().datetime().nullable().optional(),
  dateTo: z.string().datetime().nullable().optional(),
  dataCategories: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).strict().refine(value => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, "Ugyldig periode");

async function memberContext() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: member } = await db.from("rettighedshavere")
    .select("id,full_name,org_affiliations!inner(org_id)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const affiliation = Array.isArray(member?.org_affiliations) ? member.org_affiliations[0] : member?.org_affiliations;
  return member && affiliation ? { user, member, orgId: affiliation.org_id as string } : null;
}

export async function GET(request: NextRequest) {
  const context = await memberContext();
  if (!context) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const service = createServiceClient();
  const { data, error } = await service.from("subject_access_requests")
    .select("id,status,date_from,date_to,data_categories,mask_staff_names,created_at,updated_at,expires_at")
    .eq("target_member_uuid", context.member.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Anmodningerne kunne ikke hentes" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, { userId: context.user.id, orgId: context.orgId, role: "member" }, "portal", "portal.audit.sar-list"),
    action: "read", entityType: "subject_access_requests", entityLabel: "Egne indsigtsanmodninger",
    targetMemberUuid: context.member.id, purposeCode: "gdpr_article_15_self_service",
    legalBasis: "GDPR Art. 15", dataCategories: ["audit_metadata"], orgIds: [context.orgId],
    metadata: { resultCount: data?.length ?? 0 },
  });
  return NextResponse.json({ items: data ?? [] }, { headers: { "cache-control": "no-store, private" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const context = await memberContext();
  if (!context) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ugyldig anmodning" }, { status: 400 });
  const service = createServiceClient();
  const { count, error: activeError } = await service.from("subject_access_requests")
    .select("id", { count: "exact", head: true })
    .eq("target_member_uuid", context.member.id)
    .in("status", ["draft", "review", "approved", "generated", "delivered"])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (activeError) return NextResponse.json({ error: "Anmodningen kunne ikke kontrolleres" }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: "Du har allerede en aktiv indsigtsanmodning" }, { status: 409 });
  const { data: created, error } = await service.from("subject_access_requests").insert({
    org_id: context.orgId,
    target_member_uuid: context.member.id,
    target_member_label: context.member.full_name,
    date_from: parsed.data.dateFrom ?? null,
    date_to: parsed.data.dateTo ?? null,
    data_categories: parsed.data.dataCategories,
    status: "review",
    mask_staff_names: true,
    created_by: context.user.id,
  }).select("id,status,created_at").single();
  if (error || !created) return NextResponse.json({ error: "Anmodningen kunne ikke oprettes" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, { userId: context.user.id, orgId: context.orgId, role: "member" }, "portal", "portal.audit.sar"),
    action: "security_review",
    entityType: "subject_access_requests",
    entityId: created.id,
    entityLabel: "Medlem oprettede indsigtsanmodning",
    targetMemberUuid: context.member.id,
    purposeCode: "gdpr_article_15_request",
    legalBasis: "GDPR Art. 15",
    dataCategories: parsed.data.dataCategories,
    orgIds: [context.orgId],
  });
  return NextResponse.json({ item: created }, { status: 201 });
}
