import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ReplaySchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  allFailed: z.boolean().optional(),
}).strict().refine(value => Boolean(value.eventIds?.length || value.allFailed), "Vælg events til genlevering");

export async function GET() {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin"]);
  if (!caller) return NextResponse.json({ error: "Kun superadmin kan se SIEM-drift" }, { status: 403 });
  const service = createServiceClient();
  const [settingsResult, receiptResult, workerRunResult, pending, processing, delivered, failed, deadLetter, latestEvents] = await Promise.all([
    service.from("audit_control_settings").select("*").eq("singleton", true).single(),
    service.from("audit_siem_receipts").select("*").order("delivered_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("audit_worker_runs").select("*").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "pending"),
    service.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "processing"),
    service.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "delivered"),
    service.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "failed"),
    service.from("audit_siem_outbox").select("event_id", { count: "exact", head: true }).eq("status", "dead_letter"),
    service.from("audit_events").select("sequence_no").order("sequence_no", { ascending: false }).limit(100),
  ]);
  const queryError = [
    settingsResult.error, receiptResult.error, workerRunResult.error, pending.error, processing.error,
    delivered.error, failed.error, deadLetter.error, latestEvents.error,
  ].find(Boolean);
  if (queryError) {
    console.error("[audit-siem] Status could not be loaded", queryError.message);
    return NextResponse.json({ error: "SIEM-status kunne ikke hentes sikkert" }, { status: 500 });
  }
  const sequences = (latestEvents.data ?? []).map(item => item.sequence_no);
  const minSequence = sequences.length ? Math.min(...sequences) : null;
  const maxSequence = sequences.length ? Math.max(...sequences) : null;
  const integrity = minSequence == null ? { data: [] } : await service.rpc("verify_audit_chain", { p_from_sequence: minSequence, p_to_sequence: maxSequence });
  if ("error" in integrity && integrity.error) {
    console.error("[audit-siem] Integrity verification failed", integrity.error.message);
    return NextResponse.json({ error: "Auditkædens integritet kunne ikke verificeres" }, { status: 500 });
  }
  const invalidCount = (integrity.data ?? []).filter((item: { valid: boolean }) => !item.valid).length;
  return NextResponse.json({
    settings: settingsResult.data,
    lastReceipt: receiptResult.data,
    lastWorkerRun: workerRunResult.data,
    counts: {
      pending: pending.count ?? 0,
      processing: processing.count ?? 0,
      delivered: delivered.count ?? 0,
      failed: failed.count ?? 0,
      deadLetter: deadLetter.count ?? 0,
    },
    integrity: { checked: sequences.length, invalid: invalidCount, ok: invalidCount === 0 },
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin"]);
  if (!caller) return NextResponse.json({ error: "Kun superadmin kan genlevere" }, { status: 403 });
  const parsed = ReplaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ugyldigt genleveringsvalg" }, { status: 400 });
  const service = createServiceClient();
  let update = service.from("audit_siem_outbox").update({
    status: "pending", available_at: new Date().toISOString(), claimed_at: null,
    batch_id: null, last_error_code: null, updated_at: new Date().toISOString(),
  }).in("status", ["failed", "dead_letter"]);
  if (parsed.data.eventIds?.length) update = update.in("event_id", parsed.data.eventIds);
  const { data, error } = await update.select("event_id");
  if (error) return NextResponse.json({ error: "Genleveringen kunne ikke startes" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.siem-replay"),
    action: "security_review",
    entityType: "audit_siem_outbox",
    entityLabel: "SIEM-genlevering startet",
    purposeCode: "siem_delivery_recovery",
    legalBasis: "GDPR Art. 5(2), 24 og 32",
    dataCategories: ["audit_metadata"],
    metadata: { replayedCount: data?.length ?? 0, allFailed: parsed.data.allFailed === true },
  });
  return NextResponse.json({ ok: true, replayed: data?.length ?? 0 }, { headers: { "cache-control": "no-store" } });
}
