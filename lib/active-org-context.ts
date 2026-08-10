import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "dfks_active_org";

function secret() {
  const value = process.env.ORG_CONTEXT_SECRET ?? process.env.INTERNAL_API_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("ORG_CONTEXT_SECRET mangler");
  return value;
}

function signature(orgId: string) {
  return createHmac("sha256", secret()).update(orgId).digest("base64url");
}

function parseCookieValue(value: string | undefined) {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const orgId = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(orgId));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return orgId;
}

export async function readActiveOrgId() {
  return parseCookieValue((await cookies()).get(COOKIE_NAME)?.value);
}

export function readActiveOrgIdFromRequest(request: NextRequest) {
  return parseCookieValue(request.cookies.get(COOKIE_NAME)?.value);
}

export async function writeActiveOrgId(orgId: string) {
  (await cookies()).set(COOKIE_NAME, `${orgId}.${signature(orgId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function writeActiveOrgIdToResponse(response: NextResponse, orgId: string) {
  response.cookies.set(COOKIE_NAME, `${orgId}.${signature(orgId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
