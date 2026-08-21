import "server-only";

import type { NextRequest } from "next/server";

export function isSameOriginMutation(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const expectedOrigin = configured ? new URL(configured).origin : request.nextUrl.origin;
  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
