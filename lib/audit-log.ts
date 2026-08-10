export const AUDIT_ACTIONS = [
  "create", "update", "delete", "archive", "restore", "validate", "approve", "merge",
  "link", "unlink", "invite", "reset_link", "export", "download", "import", "sync", "job", "security_failure", "retention",
  "require_onboarding", "cancel_onboarding", "complete_onboarding",
] as const;

export const AUDIT_SOURCES = ["portal", "admin", "api", "cron", "import", "database"] as const;

/** Low-level relation rows stay available for forensic filtering, but are hidden from the default overview. */
export const AUDIT_DETAIL_ENTITY_TYPES = [
  "contract_episodes",
  "contract_employers",
  "work_assignments",
  "work_employers",
  "work_external_ids",
  "work_production_numbers",
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];
export type AuditSource = typeof AUDIT_SOURCES[number];
export type AuditActorType = "user" | "system" | "integration";

export type AuditContext = {
  actorUserId?: string | null;
  actorOrgId?: string | null;
  actorRole?: string | null;
  source: AuditSource;
  correlationId?: string | null;
  /** Service-role only: suppress row triggers while one semantic summary event is recorded. */
  mode?: "row" | "summary";
};

export type AuditChange = {
  field: string;
  old: unknown;
  new: unknown;
  redacted?: boolean;
};

export type AuditOrganisation = { id: string; name: string };

export type AuditEvent = {
  id: string;
  occurredAt: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorType: AuditActorType;
  actorOrgId: string | null;
  source: AuditSource;
  correlationId: string | null;
  requestId: string | null;
  changes: AuditChange[];
  missingActorContext: boolean;
  organisations: AuditOrganisation[];
};

export type AuditFilters = {
  from?: string;
  to?: string;
  orgId?: string;
  actorUserId?: string;
  role?: string;
  action?: AuditAction;
  entityType?: string;
  source?: AuditSource;
  query?: string;
  cursor?: string;
};

export type AuditCursor = { occurredAt: string; id: string };

export function encodeAuditCursor(cursor: AuditCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeAuditCursor(value: string | null | undefined): AuditCursor | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Partial<AuditCursor>;
    if (!parsed.occurredAt || !parsed.id || Number.isNaN(Date.parse(parsed.occurredAt))) return null;
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function sanitizeAuditSearch(value: string): string {
  return value.trim().slice(0, 100).replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ");
}

export function csvAuditCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function isAuditAction(value: string | null): value is AuditAction {
  return Boolean(value && (AUDIT_ACTIONS as readonly string[]).includes(value));
}

export function isAuditSource(value: string | null): value is AuditSource {
  return Boolean(value && (AUDIT_SOURCES as readonly string[]).includes(value));
}

export function auditEntityHref(event: Pick<AuditEvent, "entityType" | "entityId">): string | null {
  if (!event.entityId) return null;
  if (event.entityType === "contracts") return `/admin/kontrakter?edit=${encodeURIComponent(event.entityId)}`;
  if (event.entityType === "works") return `/admin/vaerker?edit=${encodeURIComponent(event.entityId)}`;
  if (event.entityType === "rettighedshavere") return `/admin/rettighedshavere?edit=${encodeURIComponent(event.entityId)}`;
  if (event.entityType === "employers") return `/admin/producenter?edit=${encodeURIComponent(event.entityId)}`;
  return null;
}
