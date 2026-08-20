import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { ensureSubjectAccessExports, issueSubjectAccessDownload } from "@/lib/audit-sar-storage";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const { id } = await context.params;
  const format = z.enum(["json", "csv", "pdf"]).safeParse(request.nextUrl.searchParams.get("format") ?? "pdf");
  if (!z.string().uuid().safeParse(id).success || !format.success) {
    return NextResponse.json({ error: "Ugyldig eksport" }, { status: 400 });
  }
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const service = createServiceClient();
  const { data: sar } = await service.from("subject_access_requests").select("*").eq("id", id).maybeSingle();
  if (!sar || (caller.role !== "superadmin" && sar.org_id !== caller.orgId)) {
    return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  }
  if (!["approved", "generated", "delivered"].includes(sar.status)) {
    return NextResponse.json({ error: "Anmodningen skal godkendes før eksport" }, { status: 409 });
  }
  if (!sar.mask_staff_names) {
    const { data: decision } = await service.from("audit_governance_decisions")
      .select("id,status,approved_by,proposed_by")
      .eq("id", sar.unmasking_decision_id)
      .eq("decision_type", "staff_unmasking")
      .eq("status", "effected")
      .maybeSingle();
    if (caller.role !== "superadmin" || !decision || decision.approved_by === decision.proposed_by) {
      return NextResponse.json({ error: "Afmaskeret eksport mangler en effektueret fireøjnebeslutning" }, { status: 403 });
    }
  }
  try {
    const exports = await ensureSubjectAccessExports(service, sar, caller.userId);
    const selected = exports.find(item => item.format === format.data);
    const link = await issueSubjectAccessDownload(service, sar.id, format.data);
    await recordAuditEvent({
      context: auditRequestContext(request, caller, "admin", "admin.audit.sar-export"),
      action: "sar_export",
      entityType: "subject_access_requests",
      entityId: sar.id,
      entityLabel: `Art. 15 ${format.data.toUpperCase()}`,
      targetMemberUuid: sar.target_member_uuid,
      purposeCode: "gdpr_article_15_export_link",
      legalBasis: "GDPR Art. 15",
      dataCategories: sar.data_categories ?? [],
      orgIds: [sar.org_id],
      metadata: {
        format: format.data,
        contentHash: selected?.content_hash ?? link.contentHash,
        staffIdentityMasked: sar.mask_staff_names,
        signedLinkTtlSeconds: link.expiresIn,
      },
    });
    return NextResponse.json(link, { headers: { "cache-control": "no-store, private" } });
  } catch (error) {
    console.error("[audit-sar] Export failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "Rapporten kunne ikke lagres eller udleveres sikkert" }, { status: 500 });
  }
}
