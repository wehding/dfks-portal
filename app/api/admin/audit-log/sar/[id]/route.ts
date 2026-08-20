import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  action: z.enum(["approve", "reject", "mark_delivered", "expire"]),
  maskStaffNames: z.boolean().optional(),
  balancingReason: z.string().trim().min(20).max(2000).optional(),
}).strict();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Ugyldigt id" }, { status: 400 });
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig handling" }, { status: 400 });
  const service = createServiceClient();
  const { data: existing } = await service.from("subject_access_requests").select("*").eq("id", id).maybeSingle();
  if (!existing || (caller.role !== "superadmin" && existing.org_id !== caller.orgId)) {
    return NextResponse.json({ error: "Indsigtsanmodningen blev ikke fundet" }, { status: 404 });
  }

  const wantsUnmasked = parsed.data.maskStaffNames === false;
  if (wantsUnmasked && (caller.role !== "superadmin" || !parsed.data.balancingReason)) {
    return NextResponse.json({ error: "Afmaskering kræver superadmin og en dokumenteret afvejning" }, { status: 403 });
  }
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  if (parsed.data.action === "approve") Object.assign(update, {
    status: "approved",
    reviewed_by: caller.userId,
    approved_by: caller.userId,
    reviewed_at: now,
    approved_at: now,
    mask_staff_names: wantsUnmasked ? false : true,
    balancing_reason: wantsUnmasked ? parsed.data.balancingReason : null,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (parsed.data.action === "reject") Object.assign(update, { status: "rejected", reviewed_by: caller.userId, reviewed_at: now });
  if (parsed.data.action === "mark_delivered") Object.assign(update, { status: "delivered", delivered_at: now });
  if (parsed.data.action === "expire") Object.assign(update, { status: "expired", expires_at: now });
  const { data: updated, error } = await service.from("subject_access_requests").update(update).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: "Anmodningen kunne ikke opdateres" }, { status: 500 });

  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.sar"),
    action: "security_review",
    entityType: "subject_access_requests",
    entityId: id,
    entityLabel: `Indsigtsanmodning ${parsed.data.action}`,
    targetMemberUuid: existing.target_member_uuid,
    purposeCode: "gdpr_article_15_review",
    legalBasis: "GDPR Art. 15",
    dataCategories: existing.data_categories ?? [],
    orgIds: [existing.org_id],
    metadata: { action: parsed.data.action, staffIdentityMasked: updated.mask_staff_names },
  });
  return NextResponse.json({ item: updated }, { headers: { "cache-control": "no-store" } });
}
