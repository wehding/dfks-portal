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
    const { data, error } = await db.rpc("purge_expired_audit_events", { retention: "7 years", batch_size: 10000 });
    if (error) throw new Error(error.message);
    const deletedCount = Number(data ?? 0);
    await recordAuditEvent({
      context: { source: "cron" },
      action: "retention",
      entityType: "audit_events",
      entityLabel: "Syvårs-oprydning",
      actorType: "integration",
      metadata: { deletedCount },
    });
    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    console.error("[audit-retention] Retention failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Audit-oprydningen fejlede" }, { status: 500 });
  }
}
