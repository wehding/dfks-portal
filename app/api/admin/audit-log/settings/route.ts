import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SettingsSchema = z.object({
  siemEnabled: z.boolean(),
  siemAdapter: z.enum(["google_native", "generic", "splunk", "sentinel", "elastic"]),
  siemDestinationLabel: z.string().trim().max(120).nullable(),
  kmsKeyId: z.string().trim().max(300).nullable(),
}).strict().refine(value => !value.siemEnabled || Boolean(value.siemDestinationLabel && value.kmsKeyId), {
  message: "Aktiv SIEM kræver destination og KMS-nøgle",
});

export async function GET() {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const service = createServiceClient();
  const { data, error } = await service.from("audit_control_settings").select("*").eq("singleton", true).single();
  if (error) return NextResponse.json({ error: "Indstillingerne kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ item: data }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Ugyldig oprindelse" }, { status: 403 });
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const parsed = SettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ugyldige indstillinger" }, { status: 400 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("update_audit_delivery_settings", {
    p_siem_enabled: parsed.data.siemEnabled,
    p_siem_adapter: parsed.data.siemAdapter,
    p_destination_label: parsed.data.siemDestinationLabel ?? "",
    p_kms_key_id: parsed.data.kmsKeyId ?? "",
    p_updated_by: caller.userId,
  });
  if (error || !data) return NextResponse.json({ error: "Indstillingerne kunne ikke gemmes" }, { status: 500 });
  await recordAuditEvent({
    context: auditRequestContext(request, caller, "admin", "admin.audit.settings"),
    action: "security_review",
    entityType: "audit_control_settings",
    entityLabel: "Audit- og SIEM-indstillinger",
    purposeCode: "security_configuration",
    legalBasis: "GDPR Art. 5(2), 24 og 32",
    dataCategories: ["audit_configuration"],
    metadata: { siemEnabled: data.siem_enabled, adapter: data.siem_adapter, retentionManagedByGovernance: true },
  });
  return NextResponse.json({ item: data }, { headers: { "cache-control": "no-store" } });
}
