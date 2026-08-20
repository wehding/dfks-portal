import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { fetchAuditEvents, recordAuditEvent } from "@/lib/audit-log-server";
import { contentSha256, subjectAccessCsv, subjectAccessEvents, subjectAccessJson, subjectAccessPdf } from "@/lib/audit-sar";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = z.enum(["json", "csv", "pdf"]).safeParse(request.nextUrl.searchParams.get("format") ?? "pdf");
  if (!z.string().uuid().safeParse(id).success || !format.success) return NextResponse.json({ error: "Ugyldig eksport" }, { status: 400 });
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const service = createServiceClient();
  const { data: sar } = await service.from("subject_access_requests").select("*").eq("id", id).maybeSingle();
  if (!sar || (caller.role !== "superadmin" && sar.org_id !== caller.orgId)) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 });
  if (!["approved", "generated", "delivered"].includes(sar.status)) return NextResponse.json({ error: "Anmodningen skal godkendes før eksport" }, { status: 409 });
  if (!sar.mask_staff_names && caller.role !== "superadmin") return NextResponse.json({ error: "Kun superadmin kan eksportere en afmaskeret rapport" }, { status: 403 });

  const rows = [];
  let cursor: string | undefined;
  do {
    const page = await fetchAuditEvents(service, { userId: caller.userId, orgId: sar.org_id, role: "superadmin" }, {
      orgId: sar.org_id,
      targetMemberUuid: sar.target_member_uuid,
      from: sar.date_from ?? undefined,
      to: sar.date_to ?? undefined,
      cursor,
    }, 1000);
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < 50000);
  if (cursor) return NextResponse.json({ error: "Udtrækket er for stort til direkte download. Afgræns perioden." }, { status: 413 });

  const filteredRows = sar.data_categories?.length
    ? rows.filter(event => event.dataCategories.some(category => sar.data_categories.includes(category)))
    : rows;
  const safeEvents = subjectAccessEvents(filteredRows, sar.id, sar.mask_staff_names);
  const content = format.data === "json"
    ? subjectAccessJson(safeEvents)
    : format.data === "csv"
      ? subjectAccessCsv(safeEvents)
      : await subjectAccessPdf(safeEvents, sar.target_member_label || sar.target_member_uuid);
  const hash = contentSha256(content);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: registrationError } = await service.rpc("register_subject_access_export", {
    p_request_id: sar.id,
    p_format: format.data,
    p_content_hash: hash,
    p_row_count: safeEvents.length,
    p_mask_staff_names: sar.mask_staff_names,
    p_generated_by: caller.userId,
    p_expires_at: expiresAt,
  });
  if (registrationError) return NextResponse.json({ error: "Udtrækket kunne ikke registreres sikkert" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.sar-export"),
    action: "sar_export",
    entityType: "subject_access_requests",
    entityId: sar.id,
    entityLabel: `Art. 15 ${format.data.toUpperCase()}`,
    targetMemberUuid: sar.target_member_uuid,
    purposeCode: "gdpr_article_15_export",
    legalBasis: "GDPR Art. 15",
    dataCategories: sar.data_categories ?? [],
    orgIds: [sar.org_id],
    metadata: { format: format.data, rowCount: safeEvents.length, contentHash: hash, staffIdentityMasked: sar.mask_staff_names },
  });

  const contentType = format.data === "json" ? "application/json; charset=utf-8" : format.data === "csv" ? "text/csv; charset=utf-8" : "application/pdf";
  return new NextResponse(Buffer.from(content), { headers: {
    "content-type": contentType,
    "content-disposition": `attachment; filename="dfks-indsigt-${sar.id}.${format.data}"`,
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    "x-audit-content-sha256": hash,
  } });
}
