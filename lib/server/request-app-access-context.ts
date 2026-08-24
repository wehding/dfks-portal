import "server-only";

import { cache } from "react";
import { readActiveOrgId } from "@/lib/active-org-context";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { createClient } from "@/lib/supabase/server";

export const getRequestAppAccessContext = cache(async () => {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const requestedOrgId = await readActiveOrgId().catch(() => null);
  return resolveAppAccessContext(db, requestedOrgId, user.id);
});
