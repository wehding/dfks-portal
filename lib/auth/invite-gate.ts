export const INVITE_COOKIE = "dfks_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

type InviteGateEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Testadgangen er opt-in. En efterladt INVITE_CODE må aldrig i sig selv
 * blokere den almindelige login-side i produktion eller nye browsere.
 */
export function isInviteGateEnabled(
  environment: InviteGateEnvironment = process.env
) {
  return Boolean(getInviteGateCode(environment));
}

export function getInviteGateCode(
  environment: InviteGateEnvironment = process.env
) {
  // The real production portal must never be hidden behind the temporary
  // test gate. Preview and local environments can still opt in explicitly.
  if (environment.VERCEL_ENV === "production") return null;
  if (environment.ENABLE_INVITE_GATE !== "true") return null;
  return environment.INVITE_CODE?.trim() || null;
}
