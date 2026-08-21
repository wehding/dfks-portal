import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { issueSubjectAccessDownload } from "@/lib/audit-sar-storage";
import { isSameOriginMutation } from "@/lib/request-security";
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
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const { data: member } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: "Medlemmet blev ikke fundet" }, { status: 404 });
  const service = createServiceClient();
  const { data: sar } = await service.from("subject_access_requests")
    .select("*")
    .eq("id", id)
    .eq("target_member_uuid", member.id)
    .eq("mask_staff_names", true)
    .in("status", ["generated", "delivered"])
    .maybeSingle();
  if (!sar || (sar.expires_at && new Date(sar.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ error: "Rapporten er ikke tilgængelig" }, { status: 404 });
  }
  try {
    const link = await issueSubjectAccessDownload(service, sar.id, format.data);
    await recordAuditEvent({
      context: auditRequestContext(request, { userId: user.id, orgId: sar.org_id, role: "member" }, "portal", "portal.audit.sar-export"),
      action: "download",
      entityType: "subject_access_requests",
      entityId: sar.id,
      entityLabel: `Eget Art. 15-udtræk ${format.data.toUpperCase()}`,
      targetMemberUuid: member.id,
      purposeCode: "gdpr_article_15_member_download_link",
      legalBasis: "GDPR Art. 15",
      dataCategories: sar.data_categories ?? [],
      orgIds: [sar.org_id],
      metadata: { format: format.data, contentHash: link.contentHash, staffIdentityMasked: true, signedLinkTtlSeconds: link.expiresIn },
    });
    return NextResponse.json(link, { headers: { "cache-control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Rapporten er udløbet eller endnu ikke genereret" }, { status: 404 });
  }
}
