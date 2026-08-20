import "server-only";

import type { NextRequest } from "next/server";
import type { AuditContext, AuditSource } from "@/lib/audit-log";

type AuditCaller = {
  userId: string;
  orgId: string;
  role: string;
};

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function safeRequestId(request: NextRequest) {
  return (
    firstHeaderValue(request.headers.get("x-request-id")) ??
    firstHeaderValue(request.headers.get("x-vercel-id")) ??
    firstHeaderValue(request.headers.get("cf-ray"))
  )?.slice(0, 200) ?? null;
}

function safeIpAddress(request: NextRequest) {
  const value = firstHeaderValue(request.headers.get("x-forwarded-for"))
    ?? firstHeaderValue(request.headers.get("x-real-ip"));
  if (!value) return null;
  const withoutIpv6Brackets = value.replace(/^\[|\]$/g, "");
  return /^[0-9a-f:.]+$/i.test(withoutIpv6Brackets) ? withoutIpv6Brackets : null;
}

export function auditRequestContext(
  request: NextRequest,
  caller: AuditCaller,
  source: AuditSource,
  systemComponent: string,
): AuditContext {
  return {
    actorUserId: caller.userId,
    actorOrgId: caller.orgId,
    actorRole: caller.role,
    source,
    correlationId: crypto.randomUUID(),
    requestId: safeRequestId(request),
    ipAddress: safeIpAddress(request),
    systemComponent,
  };
}
