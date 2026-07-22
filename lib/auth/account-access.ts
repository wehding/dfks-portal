export const ACCOUNT_ACCESS_MODES = ["invite", "recovery"] as const;

export type AccountAccessMode = (typeof ACCOUNT_ACCESS_MODES)[number];

export type AccountPasswordError =
  | "password_required"
  | "password_too_short"
  | "password_mismatch";

export function isAccountAccessMode(value: string | null): value is AccountAccessMode {
  return ACCOUNT_ACCESS_MODES.includes(value as AccountAccessMode);
}

export function buildAccountAccessUrl(
  siteUrl: string,
  tokenHash: string,
  mode: AccountAccessMode
): string {
  const url = new URL("/auth/confirm", siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", mode);
  return url.toString();
}

export function validateAccountPassword(
  password: string,
  confirmation: string
): AccountPasswordError | null {
  if (!password || !confirmation) return "password_required";
  if (password.length < 8) return "password_too_short";
  if (password !== confirmation) return "password_mismatch";
  return null;
}

export function accountAccessPath(
  mode: AccountAccessMode,
  error?: "invalid_link"
): string {
  const params = new URLSearchParams({ mode });
  if (error) params.set("error", error);
  return `/auth/opret-adgang?${params.toString()}`;
}
