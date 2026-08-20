import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { fetchAuditEvents, recordAuditEvent } from "@/lib/audit-log-server";
import { contentSha256, subjectAccessCsv, subjectAccessEvents, subjectAccessJson, subjectAccessPdf } from "@/lib/audit-sar";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = z.enum(["json", "csv", "pdf"]).safeParse(request.nextUrl.searchParams.get("format") ?? "pdf");
  if (!z.string().uuid().safeParse(id).success || !format.success) {
    return NextResponse.json({ error: "Ugyldig eksport" }, { status: 400 });
  }

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const { data: member } = await db.from("rettighedshavere").select("id,full_name").eq("user_id", user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: "Medlemmet blev ikke fundet" }, { status: 404 });

  const service = createServiceClient();
  const { data: sar } = await service
    .from("subject_access_requests")
    .select("*")
    .eq("id", id)
    .eq("target_member_uuid", member.id)
    .eq("mask_staff_names", true)
    .in("status", ["generated", "delivered"])
    .maybeSingle();
  if (!sar || (sar.expires_at && new Date(sar.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ error: "Rapporten er ikke tilgængelig" }, { status: 404 });
  }

  const rows = [];
  let cursor: string | undefined;
  do {
    const page = await fetchAuditEvents(service, { userId: user.id, orgId: sar.org_id, role: "superadmin" }, {
      orgId: sar.org_id,
      targetMemberUuid: member.id,
      from: sar.date_from ?? undefined,
      to: sar.date_to ?? undefined,
      cursor,
    }, 1000);
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < 50000);

  const filteredRows = sar.data_categories?.length
    ? rows.filter(event => event.dataCategories.some(category => sar.data_categories.includes(category)))
    : rows;
  const safeEvents = subjectAccessEvents(filteredRows, sar.id, true);
  const content = format.data === "json"
    ? subjectAccessJson(safeEvents)
    : format.data === "csv"
      ? subjectAccessCsv(safeEvents)
      : await subjectAccessPdf(safeEvents, member.full_name || "Medlem");
  const hash = contentSha256(content);

  await recordAuditEvent({
    context: auditRequestContext(request, { userId: user.id, orgId: sar.org_id, role: "member" }, "portal", "portal.audit.sar-export"),
    action: "download",
    entityType: "subject_access_requests",
    entityId: sar.id,
    entityLabel: `Eget Art. 15-udtræk ${format.data.toUpperCase()}`,
    targetMemberUuid: member.id,
    purposeCode: "gdpr_article_15_member_download",
    legalBasis: "GDPR Art. 15",
    dataCategories: sar.data_categories ?? [],
    orgIds: [sar.org_id],
    metadata: { format: format.data, rowCount: safeEvents.length, contentHash: hash, staffIdentityMasked: true },
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
