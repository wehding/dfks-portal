"use server";

import { createClient } from "@/lib/supabase/server";
import { requireConfiguredSiteUrl } from "@/lib/site-url";

export async function sendOwnPasswordResetEmail() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { success: false as const, error: "Din bruger mangler en e-mailadresse." };
  let siteUrl: string;
  try {
    siteUrl = requireConfiguredSiteUrl();
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Portaladressen er ikke konfigureret." };
  }
  const redirectUrl = new URL("/auth/confirm", siteUrl);
  redirectUrl.searchParams.set("type", "recovery");
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: redirectUrl.toString(),
  });
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, email: user.email };
}
