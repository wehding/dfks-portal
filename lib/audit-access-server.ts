import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import type { AuditAction, AuditContext, AuditSource } from "@/lib/audit-log";

type AuditCaller = { userId: string; orgId: string; role: string };

function normalizedIp(candidate: string | null): string | null {
  const value = candidate?.split(",")[0]?.trim();
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/i.test(value)) return null;
  return value;
}

export function auditRequestContext(
  request: NextRequest,
  caller: AuditCaller | null,
  source: AuditSource,
  systemComponent: string,
): AuditContext {
  return auditHeadersContext(request.headers, caller, source, systemComponent);
}

export function auditHeadersContext(
  headers: Headers,
  caller: AuditCaller | null,
  source: AuditSource,
  systemComponent: string,
): AuditContext {
  const trustProxy = process.env.VERCEL === "1" || process.env.TRUST_PROXY_HEADERS === "true";
  const ipAddress = trustProxy
    ? normalizedIp(headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip"))
    : null;
  const requestId = headers.get("x-vercel-id")?.slice(0, 200)
    ?? headers.get("x-request-id")?.slice(0, 200)
    ?? randomUUID();
  return {
    actorUserId: caller?.userId ?? null,
    actorOrgId: caller?.orgId ?? null,
    actorRole: caller?.role ?? null,
    source,
    correlationId: randomUUID(),
    requestId,
    ipAddress,
    systemComponent,
  };
}

export function auditSearchFingerprint(value: string): string | null {
  const secret = process.env.AUDIT_FINGERPRINT_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(value.trim().toLocaleLowerCase("da-DK")).digest("hex");
}

export async function withMemberDataAudit<T>(input: {
  context: AuditContext;
  action: Extract<AuditAction, "read" | "search" | "download" | "ai_analysis">;
  targetMemberUuid?: string | null;
  targetMemberUuids?: string[];
  purposeCode: string;
  legalBasis?: string | null;
  dataCategories: string[];
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  orgIds?: string[];
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    const result = await input.run();
    await recordAuditEvent({
      context: input.context,
      action: input.action,
      targetMemberUuid: input.targetMemberUuid,
      targetMemberUuids: input.targetMemberUuids,
      purposeCode: input.purposeCode,
      legalBasis: input.legalBasis,
      dataCategories: input.dataCategories,
      systemComponent: input.context.systemComponent,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      orgIds: input.orgIds,
      metadata: input.metadata,
      outcome: "success",
    });
    return result;
  } catch (error) {
    try {
      await recordAuditEvent({
        context: input.context,
        action: input.action,
        targetMemberUuid: input.targetMemberUuid,
        targetMemberUuids: input.targetMemberUuids,
        purposeCode: input.purposeCode,
        legalBasis: input.legalBasis,
        dataCategories: input.dataCategories,
        systemComponent: input.context.systemComponent,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel,
        orgIds: input.orgIds,
        metadata: input.metadata,
        outcome: "failed",
        errorCode: error instanceof Error ? error.name.slice(0, 80) : "unknown_error",
      });
    } catch {
      // Preserve the original failure. Successful reads fail closed above when
      // their mandatory audit record cannot be appended.
    }
    throw error;
  }
}
