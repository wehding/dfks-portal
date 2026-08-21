import { createHmac } from "node:crypto";
import type { AuditEvent } from "@/lib/audit-log";

export type SubjectAccessEvent = {
  eventId: string;
  timestamp: string;
  action: string;
  purpose: string;
  legalBasis: string | null;
  actor: string;
  actorRole: string | null;
  systemComponent: string;
  dataCategories: string[];
  outcome: string;
};

function pseudonymForIndex(index: number): string {
  let value = index;
  let suffix = "";
  do {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `[SAGSBEHANDLER_${suffix}]`;
}

export function buildStaffPseudonyms(events: readonly AuditEvent[], requestId: string): Map<string, string> {
  const actorIds = [...new Set(events.map(event => event.actorUserId).filter((value): value is string => Boolean(value)))];
  actorIds.sort((left, right) => {
    const leftHash = createHmac("sha256", requestId).update(left).digest("hex");
    const rightHash = createHmac("sha256", requestId).update(right).digest("hex");
    return leftHash.localeCompare(rightHash);
  });
  return new Map(actorIds.map((actorId, index) => [actorId, pseudonymForIndex(index)]));
}

export function subjectAccessEvents(
  events: readonly AuditEvent[],
  requestId: string,
  maskStaffNames = true,
): SubjectAccessEvent[] {
  const pseudonyms = buildStaffPseudonyms(events, requestId);
  return events.map(event => ({
    eventId: event.id,
    timestamp: event.occurredAt,
    action: event.action,
    purpose: event.purposeCode ?? "ikke_angivet",
    legalBasis: event.legalBasis,
    actor: event.actorRole === "member"
      ? "[MEDLEM]"
      : event.actorType !== "user"
      ? event.actorType === "integration" ? "[INTEGRATION]" : "[SYSTEM]"
      : maskStaffNames
        ? pseudonyms.get(event.actorUserId ?? "") ?? "[SAGSBEHANDLER]"
        : event.actorDisplayName ?? "[SAGSBEHANDLER]",
    actorRole: event.actorRole,
    systemComponent: event.systemComponent ?? event.source,
    dataCategories: event.dataCategories,
    outcome: event.outcome,
  }));
}
