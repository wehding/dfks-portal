import { redirect } from "next/navigation";
import { AuditControlCenter } from "@/components/admin/audit-control-center";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) redirect("/admin");
  return <AuditControlCenter callerRole={caller.role} />;
}
