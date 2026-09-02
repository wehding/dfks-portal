import "server-only";

import { randomUUID } from "node:crypto";
import type { AuditAction, AuditSource } from "@/lib/audit-log";
import { recordAuditEvent } from "@/lib/audit-log-server";

type SensitiveActor = {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  source: AuditSource;
};

/**
 * Semantic boundary for sensitive flows that do not need the full request
 * wrapper. Only identifiers, categorical metadata and counts are accepted, so
 * document text, search terms, prompts, salary values and contact details
 * cannot accidentally be placed in the audit log.
 */
export async function recordSensitiveFlow(input: {
  actor: SensitiveActor;
  action: AuditAction;
  component: string;
  entityType: string;
  entityId?: string | null;
  targetMemberUuid?: string | null;
  targetMemberUuids?: string[];
  orgIds?: string[];
  purposeCode: string;
  legalBasis: string;
  dataCategories: string[];
  outcome?: "success" | "denied" | "failed" | "partial";
  correlationId?: string | null;
  counts?: Record<string, number | boolean | null>;
}) {
  return recordAuditEvent({
    context: {
      actorUserId: input.actor.userId ?? null,
      actorOrgId: input.actor.orgId ?? null,
      actorRole: input.actor.role ?? null,
      source: input.actor.source,
      correlationId: input.correlationId ?? randomUUID(),
      systemComponent: input.component,
      mode: "summary",
    },
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    targetMemberUuid: input.targetMemberUuid ?? null,
    targetMemberUuids: input.targetMemberUuids,
    orgIds: input.orgIds,
    purposeCode: input.purposeCode,
    legalBasis: input.legalBasis,
    dataCategories: input.dataCategories,
    systemComponent: input.component,
    outcome: input.outcome ?? "success",
    metadata: input.counts ? { counts: input.counts } : undefined,
  });
}
