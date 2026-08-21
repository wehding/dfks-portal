import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ProposeSchema = z.object({
  decisionType: z.enum(["retention_change", "staff_unmasking"]),
  orgId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(20).max(4000),
  legalBasis: z.string().trim().min(3).max(500),
  retentionYears: z.number().int().min(1).max(30).nullable().optional(),
  subjectAccessRequestId: z.string().uuid().nullable().optional(),
  dateFrom: z.string().datetime().nullable().optional(),
  dateTo: z.string().datetime().nullable().optional(),
}).strict().refine(value => value.decisionType === "retention_change"
  ? Boolean(value.retentionYears && !value.subjectAccessRequestId)
  : Boolean(value.subjectAccessRequestId && !value.retentionYears), "Beslutningens omfang er ufuldstændigt");

const DecisionSchema = z.object({
  decisionId: z.string().uuid(),
  action: z.enum(["approve", "reject", "effect"]),
}).strict();

async function governanceCaller() {
  const db = await createClient();
  return { db, caller: await assertAdminRole(db, ["jurist", "superadmin"]) };
}

export async function GET() {
  const { caller } = await governanceCaller();
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const service = createServiceClient();
  let query = service.from("audit_governance_decisions").select("*").order("proposed_at", { ascending: false });
  if (caller.role !== "superadmin") query = query.eq("org_id", caller.orgId);
  const [{ data, error }, { data: requests }] = await Promise.all([
    query,
    service.from("subject_access_requests")
      .select("id,target_member_label,status,mask_staff_names,org_id")
      .eq("org_id", caller.orgId)
      .in("status", ["review", "approved", "generated"]),
  ]);
  if (error) return NextResponse.json({ error: "Governancebeslutningerne kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ items: data ?? [], requests: requests ?? [], callerRole: caller.role }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const { caller } = await governanceCaller();
  if (!caller || caller.role !== "jurist") return NextResponse.json({ error: "Kun en jurist kan indstille" }, { status: 403 });
  const parsed = ProposeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ugyldig indstilling" }, { status: 400 });
  const service = createServiceClient();
  const orgId = parsed.data.decisionType === "retention_change" ? null : caller.orgId;
  if (parsed.data.subjectAccessRequestId) {
    const { data: sar } = await service.from("subject_access_requests").select("id,org_id")
      .eq("id", parsed.data.subjectAccessRequestId).eq("org_id", caller.orgId).maybeSingle();
    if (!sar) return NextResponse.json({ error: "Indsigtsanmodningen blev ikke fundet i organisationen" }, { status: 404 });
  }
  const { data: decisionId, error } = await service.rpc("propose_audit_governance_decision", {
    p_org_id: orgId,
    p_decision_type: parsed.data.decisionType,
    p_proposed_by: caller.userId,
    p_proposer_role: caller.role,
    p_reason: parsed.data.reason,
    p_legal_basis: parsed.data.legalBasis,
    p_retention_years: parsed.data.retentionYears ?? null,
    p_subject_access_request_id: parsed.data.subjectAccessRequestId ?? null,
    p_date_from: parsed.data.dateFrom ?? null,
    p_date_to: parsed.data.dateTo ?? null,
  });
  if (error || !decisionId) return NextResponse.json({ error: "Indstillingen kunne ikke oprettes" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.governance"),
    action: "security_review", entityType: "audit_governance_decisions", entityId: String(decisionId),
    entityLabel: "Governanceindstilling", purposeCode: "privacy_governance",
    legalBasis: parsed.data.legalBasis, dataCategories: ["audit_configuration"],
    orgIds: orgId ? [orgId] : [], metadata: { decisionType: parsed.data.decisionType },
  });
  return NextResponse.json({ id: decisionId }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const { caller } = await governanceCaller();
  if (!caller || caller.role !== "superadmin") return NextResponse.json({ error: "Kun superadmin kan godkende eller effektuere" }, { status: 403 });
  const parsed = DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig beslutning" }, { status: 400 });
  const service = createServiceClient();
  const rpc = parsed.data.action === "effect"
    ? await service.rpc("effect_audit_governance_decision", { p_decision_id: parsed.data.decisionId })
    : await service.rpc("decide_audit_governance_decision", {
      p_decision_id: parsed.data.decisionId,
      p_approved: parsed.data.action === "approve",
      p_approved_by: caller.userId,
      p_approver_role: caller.role,
    });
  if (rpc.error) {
    const fourEyes = /four-eyes/i.test(rpc.error.message);
    return NextResponse.json({ error: fourEyes ? "Indstiller og godkender skal være to forskellige brugere" : "Beslutningen kunne ikke opdateres" }, { status: fourEyes ? 409 : 500 });
  }
  const item = rpc.data;
  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.governance"),
    action: "security_review", entityType: "audit_governance_decisions", entityId: parsed.data.decisionId,
    entityLabel: `Governance ${parsed.data.action}`, purposeCode: "privacy_governance",
    legalBasis: "GDPR Art. 5(2), 24 og 32", dataCategories: ["audit_configuration"],
    orgIds: item?.org_id ? [item.org_id] : [], metadata: { action: parsed.data.action, decisionType: item?.decision_type },
  });
  return NextResponse.json({ item });
}
