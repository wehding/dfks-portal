import type { AccountAccessMode } from "@/lib/auth/account-access";

export function invitationAccessType(existingUserId: string | null | undefined): AccountAccessMode {
  return existingUserId ? "recovery" : "invite";
}

export function isNewUserLimitReached(params: {
  existingUserId: string | null | undefined;
  currentUsers: number;
  maxUsers: number;
}): boolean {
  if (params.existingUserId || params.maxUsers === -1) return false;
  return params.currentUsers >= params.maxUsers;
}

export function inviteSentAtAfterMail(mailSent: boolean, now: string): string | null {
  return mailSent ? now : null;
}
