import { redirect } from "next/navigation";
import { AuditLogClient } from "@/components/admin/audit-log-client";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin"]);
  if (!caller) redirect("/admin");
  return <AuditLogClient />;
}
