import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CreateRequestSchema = z.object({
  targetMemberUuid: z.string().uuid(),
  orgId: z.string().uuid().optional(),
  dateFrom: z.string().datetime({ offset: true }).nullable().optional(),
  dateTo: z.string().datetime({ offset: true }).nullable().optional(),
  dataCategories: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).strict();

async function callerForSar() {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin", "jurist"]);
  return { db, caller };
}

export async function GET() {
  const { caller } = await callerForSar();
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const service = createServiceClient();
  let query = service.from("subject_access_requests").select("*").order("created_at", { ascending: false }).limit(250);
  if (caller.role !== "superadmin") query = query.eq("org_id", caller.orgId);
  const { data: requests, error } = await query;
  if (error) return NextResponse.json({ error: "Indsigtsanmodninger kunne ikke hentes" }, { status: 500 });
  const memberIds = [...new Set((requests ?? []).map(item => item.target_member_uuid))];
  const { data: members, error: membersError } = memberIds.length
    ? await service.from("rettighedshavere").select("id,full_name").in("id", memberIds)
    : { data: [], error: null };
  if (membersError) return NextResponse.json({ error: "Medlemsnavne kunne ikke hentes" }, { status: 500 });
  const names = new Map((members ?? []).map(member => [member.id, member.full_name]));
  const organisationIds = [...new Set((requests ?? []).map(item => item.org_id))];
  const { data: organisations, error: organisationsError } = organisationIds.length
    ? await service.from("organisations").select("id,name").in("id", organisationIds)
    : { data: [], error: null };
  if (organisationsError) return NextResponse.json({ error: "Organisationer kunne ikke hentes" }, { status: 500 });
  const organisationNames = new Map((organisations ?? []).map(organisation => [organisation.id, organisation.name]));
  const availableMemberQuery = service.from("rettighedshavere")
    .select("id,full_name,org_affiliations!inner(org_id,organisations!inner(name))")
    .order("full_name")
    .limit(500);
  if (caller.role !== "superadmin") availableMemberQuery.eq("org_affiliations.org_id", caller.orgId);
  const { data: availableMembers, error: availableMembersError } = await availableMemberQuery;
  if (availableMembersError) return NextResponse.json({ error: "Medlemslisten kunne ikke hentes" }, { status: 500 });
  const memberOptions = (availableMembers ?? []).flatMap(member => {
    const affiliations = Array.isArray(member.org_affiliations) ? member.org_affiliations : [];
    return affiliations.map(affiliation => {
      const organisationRelation = Array.isArray(affiliation.organisations) ? affiliation.organisations[0] : affiliation.organisations;
      return {
        id: member.id,
        name: member.full_name,
        orgId: affiliation.org_id,
        orgName: organisationRelation?.name ?? organisationNames.get(affiliation.org_id) ?? "Ukendt organisation",
      };
    });
  });
  return NextResponse.json({
    items: (requests ?? []).map(item => ({
      ...item,
      target_member_label: item.target_member_label || names.get(item.target_member_uuid) || "Ukendt medlem",
      org_label: organisationNames.get(item.org_id) || "Ukendt organisation",
    })),
    callerRole: caller.role,
    members: memberOptions,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const { caller } = await callerForSar();
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const parsed = CreateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldige oplysninger" }, { status: 400 });
  if (caller.role === "superadmin" && !parsed.data.orgId) {
    return NextResponse.json({ error: "Vælg den organisation, anmodningen vedrører" }, { status: 400 });
  }
  const orgId = caller.role === "superadmin" ? parsed.data.orgId! : caller.orgId;
  const service = createServiceClient();
  const { data: member, error: memberError } = await service.from("rettighedshavere")
    .select("id,full_name,org_affiliations!inner(org_id)")
    .eq("id", parsed.data.targetMemberUuid)
    .eq("org_affiliations.org_id", orgId)
    .maybeSingle();
  if (memberError) return NextResponse.json({ error: "Medlemmet kunne ikke kontrolleres" }, { status: 500 });
  if (!member) return NextResponse.json({ error: "Medlemmet findes ikke i organisationen" }, { status: 404 });

  const { data: created, error } = await service.from("subject_access_requests").insert({
    org_id: orgId,
    target_member_uuid: parsed.data.targetMemberUuid,
    target_member_label: member.full_name,
    date_from: parsed.data.dateFrom ?? null,
    date_to: parsed.data.dateTo ?? null,
    data_categories: parsed.data.dataCategories,
    status: "review",
    mask_staff_names: true,
    created_by: caller.userId,
  }).select("*").single();
  if (error || !created) return NextResponse.json({ error: "Indsigtsanmodningen kunne ikke oprettes" }, { status: 500 });

  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.sar"),
    action: "security_review",
    entityType: "subject_access_requests",
    entityId: created.id,
    entityLabel: "Indsigtsanmodning oprettet",
    targetMemberUuid: parsed.data.targetMemberUuid,
    purposeCode: "gdpr_article_15",
    legalBasis: "GDPR Art. 15",
    dataCategories: parsed.data.dataCategories,
    orgIds: [orgId],
  });
  return NextResponse.json({ item: created }, { status: 201, headers: { "cache-control": "no-store" } });
}
