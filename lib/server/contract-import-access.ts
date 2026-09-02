import "server-only";

import { ADMIN_ROLES } from "@/lib/admin-roles";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Contract imports are part of the ordinary contract workflow. Jurists may
 * therefore create, inspect and retry an import, while ownership remains a
 * separate manager-only capability.
 */
export async function requireContractImportWriteAccess() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ADMIN_ROLES);
  if (!caller) return null;

  const access = await getRequestAppAccessContext();
  if (
    access?.orgId !== caller.orgId
    || !access.modules?.contracts?.write
  ) return null;

  return {
    caller,
    canManageOwnership: Boolean(access.modules.contract_ownership?.write),
  };
}
