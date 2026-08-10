export type OnboardingStatus =
  | "no_portal_user"
  | "first_time_required"
  | "completed"
  | "reset_scheduled"
  | "reset_required";

export type OnboardingStateInput = {
  hasPortalUser: boolean;
  completedAt?: string | null;
  requiredAt?: string | null;
  lastSignInAt?: string | null;
};

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveOnboardingStatus(input: OnboardingStateInput): OnboardingStatus {
  if (!input.hasPortalUser) return "no_portal_user";
  const completedAt = timestamp(input.completedAt);
  if (completedAt == null) return "first_time_required";
  const requiredAt = timestamp(input.requiredAt);
  if (requiredAt == null || requiredAt <= completedAt) return "completed";
  const lastSignInAt = timestamp(input.lastSignInAt);
  return lastSignInAt != null && lastSignInAt >= requiredAt ? "reset_required" : "reset_scheduled";
}

export function mustCompleteOnboarding(status: OnboardingStatus): boolean {
  return status === "first_time_required" || status === "reset_required";
}
