import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSubjectAccessExports } from "@/lib/audit-sar-storage";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }
  try {
    const service = createServiceClient({ audit: { source: "cron" } });
    const deletedCount = await cleanupExpiredSubjectAccessExports(service);
    await recordAuditEvent({
      context: { source: "cron" },
      action: "retention",
      entityType: "subject_access_exports",
      entityLabel: "24-timers oprydning af indsigtsrapporter",
      actorType: "integration",
      purposeCode: "sar_export_expiry",
      legalBasis: "GDPR Art. 5(1)(e)",
      dataCategories: ["audit_metadata"],
      metadata: { deletedCount, fileTtlHours: 24 },
    });
    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    console.error("[audit-sar-cleanup] Cleanup failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "Oprydningen fejlede" }, { status: 500 });
  }
}
