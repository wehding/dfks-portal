import { NextRequest, NextResponse } from "next/server";
import { fetchMemberWorkOverview } from "@/app/actions/member-works";
import { createFilmographyCsv, createFilmographyPdf, type FilmographyRow } from "@/lib/member-filmography-export";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { createServiceClient } from "@/lib/supabase/service";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import type { MemberOverviewItem } from "@/lib/member-work-overview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getRequestAppAccessContext();
  if (!context?.userId) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  if (!context.rightsHolderId || !context.canUseMember) return NextResponse.json({ error: "Ingen medlemsadgang i den aktive organisation" }, { status: 403 });
  const format = request.nextUrl.searchParams.get("format");
  if (format !== "csv" && format !== "pdf") return NextResponse.json({ error: "Format skal være csv eller pdf" }, { status: 400 });

  const rows: FilmographyRow[] = [];
  let page = 1;
  let hasNextPage = true;
  while (hasNextPage && page <= 100) {
    const result = await fetchMemberWorkOverview({ rightsHolderId: context.rightsHolderId, page, pageSize: 100, sortKey: "year", sortDir: "desc" });
    if (!result.success) return NextResponse.json({ error: "Filmografien kunne ikke hentes" }, { status: 500 });
    for (const item of result.items as MemberOverviewItem[]) {
      if (item.kind === "season") rows.push({ title: item.title, year: item.year, type: item.type, role: item.roleSummary, seasonNumber: item.seasonNumber });
      else rows.push({ title: item.work.title, year: item.work.year, type: item.work.type, role: item.work.assignment.role, seasonNumber: item.work.season_number ?? null });
    }
    hasNextPage = Boolean(result.hasNextPage);
    page += 1;
  }

  const db = createServiceClient();
  const [{ data: holder }, { data: organisation }] = await Promise.all([
    db.from("rettighedshavere").select("full_name").eq("id", context.rightsHolderId).eq("user_id", context.userId).maybeSingle(),
    db.from("organisations").select("name").eq("id", context.orgId).maybeSingle(),
  ]);
  if (!holder) return NextResponse.json({ error: "Rettighedshaveren blev ikke fundet" }, { status: 403 });

  await recordSensitiveFlow({
    actor: { userId: context.userId, orgId: context.orgId, role: "member", source: "portal" },
    action: "export", component: "portal.member-filmography.export", entityType: "work_assignments",
    targetMemberUuid: context.rightsHolderId, orgIds: [context.orgId], purposeCode: "member_self_service",
    legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["identity_data", "work_data", "union_membership_data"],
    counts: { rows: rows.length },
  });

  const date = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new NextResponse(`\uFEFF${createFilmographyCsv(rows)}`, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="filmografi-${date}.csv"`,
      "Cache-Control": "private, no-store",
    } });
  }
  const bytes = await createFilmographyPdf({ memberName: holder.full_name, organisationName: organisation?.name ?? context.brand.short_name, rows });
  return new NextResponse(Buffer.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="filmografi-${date}.pdf"`,
    "Cache-Control": "private, no-store",
  } });
}
