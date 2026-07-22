"use server";

import { validateAccountPassword, type AccountPasswordError } from "@/lib/auth/account-access";
import { resolvePostLoginDestination } from "@/lib/auth/post-login";
import { resolveOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

type SetAccountPasswordError =
  | AccountPasswordError
  | "missing_session"
  | "missing_org"
  | "update_failed";

export type SetAccountPasswordResult =
  | { ok: true; destination: string }
  | { ok: false; error: SetAccountPasswordError };

export async function setAccountPassword(input: {
  password: string;
  confirmation: string;
}): Promise<SetAccountPasswordResult> {
  const validationError = validateAccountPassword(input.password, input.confirmation);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "missing_session" };

  const orgId = await resolveOrgId(supabase, user.id);
  if (!orgId) return { ok: false, error: "missing_org" };

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: "update_failed" };

  return {
    ok: true,
    destination: await resolvePostLoginDestination(supabase, user.id),
  };
}
