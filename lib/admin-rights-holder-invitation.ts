export type RightsHolderInvitationState = "active" | "invited" | "not_invited";

export function rightsHolderInvitationState(holder: {
  onboarding_completed?: boolean | null;
  onboarding_completed_at?: string | null;
  invite_sent_at?: string | null;
}): RightsHolderInvitationState {
  if (holder.onboarding_completed_at || holder.onboarding_completed) return "active";
  if (holder.invite_sent_at) return "invited";
  return "not_invited";
}

export function rightsHolderPortalAction(holder: {
  onboarding_completed?: boolean | null;
  onboarding_completed_at?: string | null;
  invite_sent_at?: string | null;
}): "invite" | "reminder" | "login" {
  const state = rightsHolderInvitationState(holder);
  return state === "active" ? "login" : state === "invited" ? "reminder" : "invite";
}
