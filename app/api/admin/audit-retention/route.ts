import { NextRequest, NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }
  try {
    const db = createServiceClient({ audit: { source: "cron" } });
    const { data: settings, error: settingsError } = await db
      .from("audit_control_settings")
      .select("retention_years")
      .eq("id", 1)
      .single();
    if (settingsError) throw new Error(settingsError.message);
    const retentionYears = Math.min(Math.max(Number(settings?.retention_years ?? 7), 1), 25);
    const { data, error } = await db.rpc("purge_expired_audit_events", {
      retention: `${retentionYears} years`,
      batch_size: 10000,
    });
    if (error) throw new Error(error.message);
    const deletedCount = Number(data ?? 0);
    await recordAuditEvent({
      context: { source: "cron" },
      action: "retention",
      entityType: "audit_events",
      entityLabel: `${retentionYears}-års-oprydning`,
      actorType: "integration",
      metadata: { deletedCount, retentionYears },
    });
    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    console.error("[audit-retention] Retention failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Audit-oprydningen fejlede" }, { status: 500 });
  }
}
