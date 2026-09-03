"use server";

import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createClient } from "@/lib/supabase/server";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recordSuperadminInsightsExport(input: {
  orgId?: string | null;
  errorCount: number;
}) {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin"]);
  if (!caller) throw new Error("Ikke autoriseret");

  const orgId = input.orgId && UUID_PATTERN.test(input.orgId) ? input.orgId : null;
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "export",
    component: "admin.superadmin.insights.error_report",
    entityType: "audit_insights_report",
    orgIds: orgId ? [orgId] : [],
    purposeCode: "security_incident_support",
    legalBasis: "GDPR Art. 6(1)(f), Art. 9(2)(d)",
    dataCategories: ["audit_data", "usage_data"],
    counts: {
      errorCount: Math.max(0, Math.min(Number(input.errorCount) || 0, 10_000)),
      filteredByOrganisation: Boolean(orgId),
    },
  });
}
