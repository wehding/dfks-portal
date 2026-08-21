import { NextRequest, NextResponse } from "next/server";
import { csvAuditCell, isAuditAction, isAuditSource, type AuditEvent, type AuditFilters } from "@/lib/audit-log";
import { fetchAuditEvents, recordAuditEvent } from "@/lib/audit-log-server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";

export const dynamic = "force-dynamic";

function filtersFromRequest(req: NextRequest): AuditFilters {
  const params = req.nextUrl.searchParams;
  const action = params.get("action");
  const source = params.get("source");
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    orgId: params.get("orgId") ?? undefined,
    actorUserId: params.get("actorUserId") ?? undefined,
    role: params.get("role")?.slice(0, 50) || undefined,
    action: isAuditAction(action) ? action : undefined,
    entityType: params.get("entityType")?.slice(0, 100) || undefined,
    source: isAuditSource(source) ? source : undefined,
    targetMemberUuid: z.string().uuid().safeParse(params.get("targetMemberUuid")).data,
    purposeCode: params.get("purposeCode")?.slice(0, 80) || undefined,
    systemComponent: params.get("systemComponent")?.slice(0, 120) || undefined,
    outcome: z.enum(["success", "denied", "failed", "partial"]).safeParse(params.get("outcome")).data,
    query: params.get("query")?.slice(0, 100) || undefined,
  };
}

function changesSummary(event: AuditEvent) {
  return event.changes.map(change => change.redacted ? `${change.field}: ændret (skjult)` : change.field).join(", ");
}

export async function GET(req: NextRequest) {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  try {
    const filters = filtersFromRequest(req);
    const rows: AuditEvent[] = [];
    let cursor: string | undefined;
    while (rows.length < 50000) {
      const page = await fetchAuditEvents(db, caller, { ...filters, cursor }, Math.min(1000, 50000 - rows.length));
      rows.push(...page.items);
      if (!page.nextCursor) { cursor = undefined; break; }
      cursor = page.nextCursor;
    }
    if (cursor) return NextResponse.json({ error: "Eksporten er for stor. Afgræns perioden eller organisationen." }, { status: 413 });
    const header = [
      "Hændelses-id", "Tidspunkt (UTC)", "Organisation", "Aktør", "E-mail", "Rolle", "Handling",
      "Målmedlem", "Formål", "Retsgrundlag", "Datakategorier", "Systemkomponent", "Resultat", "Fejlkode",
      "Entitetstype", "Entitet", "Entitets-id", "Ændrede felter", "Kilde", "Request-id", "Korrelations-id",
      "Sekvens", "Integritet",
      ...(caller.role === "superadmin" ? ["IP-adresse"] : []),
    ];
    const csvRows = rows.map(event => [
      event.id,
      event.occurredAt,
      event.organisations.map(org => org.name).join(" | "),
      event.actorDisplayName ?? (event.actorType === "system" ? "System" : "Integration"),
      event.actorEmail ?? "",
      event.actorRole ?? "",
      event.action,
      event.targetMemberUuid ?? "",
      event.purposeCode ?? "",
      event.legalBasis ?? "",
      event.dataCategories.join(" | "),
      event.systemComponent ?? "",
      event.outcome,
      event.errorCode ?? "",
      event.entityType,
      event.entityLabel ?? "",
      event.entityId ?? "",
      changesSummary(event),
      event.source,
      event.requestId ?? "",
      event.correlationId ?? "",
      event.sequenceNo,
      event.integrityValid ? "verificeret" : "fejl",
      ...(caller.role === "superadmin" ? [event.ipAddress ?? ""] : []),
    ]);
    const csv = `\uFEFF${[header, ...csvRows].map(row => row.map(csvAuditCell).join(";")).join("\r\n")}`;
    await recordAuditEvent({
      context: auditRequestContext(req, caller, "admin", "admin.audit.export"),
      action: "export",
      entityType: "audit_events",
      entityLabel: "Auditlog CSV",
      purposeCode: "audit_oversight",
      legalBasis: "GDPR Art. 5(2), 24 og 32",
      dataCategories: ["audit_metadata"],
      orgIds: caller.role === "superadmin" ? (filters.orgId ? [filters.orgId] : []) : [caller.orgId],
      metadata: { rowCount: rows.length, filteredOrganisation: filters.orgId ?? null },
    });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dfks-auditlog-${timestamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[audit-log/export] Export failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Auditloggen kunne ikke eksporteres" }, { status: 500 });
  }
}
