"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolveOnboardingStatus } from "@/lib/auth/onboarding-state";
import { useI18n } from "@/lib/i18n";

export function OnboardingRequirementBanner() {
  const { t } = useI18n();
  const [scheduled, setScheduled] = useState(false);
  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setScheduled(false);
    const { data: holder } = await supabase.from("rettighedshavere")
      .select("user_id,onboarding_completed_at,onboarding_required_at")
      .eq("user_id", user.id).limit(1).maybeSingle();
    setScheduled(Boolean(holder && resolveOnboardingStatus({
      hasPortalUser: Boolean(holder.user_id),
      completedAt: holder.onboarding_completed_at,
      requiredAt: holder.onboarding_required_at,
      lastSignInAt: user.last_sign_in_at,
    }) === "reset_scheduled"));
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    window.addEventListener("onboarding-requirement-changed", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("onboarding-requirement-changed", refresh);
    };
  }, [refresh]);

  if (!scheduled) return null;
  return (
    <div role="status" className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:mx-4 lg:mx-6">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{t("onboarding.scheduledBanner")}</span>
    </div>
  );
}
