import type { CookieOptions } from "@supabase/ssr";
import type { NextResponse } from "next/server";

export type PendingAuthCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export const PRIVATE_AUTH_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

type AuthFailure = { status?: number; code?: string; message?: string } | null | undefined;

export function isRecoverableExpiredSession(error: AuthFailure): boolean {
  if (!error) return false;
  const code = String(error.code ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();
  return code === "refresh_token_not_found"
    || code === "refresh_token_already_used"
    || message.includes("refresh token not found")
    || message.includes("invalid refresh token");
}

export function supabaseAuthCookiePrefix(supabaseUrl: string): string | null {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function expiredSupabaseAuthCookies(
  cookieNames: readonly string[],
  supabaseUrl: string,
): PendingAuthCookie[] {
  const prefix = supabaseAuthCookiePrefix(supabaseUrl);
  if (!prefix) return [];
  return cookieNames
    .filter(name => name === prefix || name.startsWith(`${prefix}.`))
    .map(name => ({
      name,
      value: "",
      options: { path: "/", maxAge: 0, expires: new Date(0), sameSite: "lax" as const },
    }));
}

export function applyAuthResponse<T extends NextResponse>(
  response: T,
  cookies: readonly PendingAuthCookie[],
  headers: Readonly<Record<string, string>> = PRIVATE_AUTH_RESPONSE_HEADERS,
): T {
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  for (const [name, value] of Object.entries({
    ...PRIVATE_AUTH_RESPONSE_HEADERS,
    ...headers,
  })) {
    response.headers.set(name, value);
  }
  return response;
}
