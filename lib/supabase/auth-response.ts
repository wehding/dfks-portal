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
