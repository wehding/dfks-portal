import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeAuditCursor,
  encodeAuditCursor,
  sanitizeAuditSearch,
  type AuditAction,
  type AuditChange,
  type AuditContext,
  type AuditEvent,
  type AuditFilters,
  type AuditSource,
} from "@/lib/audit-log";
import { createServiceClient } from "@/lib/supabase/service";

type AdminCaller = { userId: string; orgId: string; role: string };

type RawAuditEvent = {
  id: string;
  occurred_at: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  actor_user_id: string | null;
  actor_display_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_type: "user" | "system" | "integration";
  actor_org_id: string | null;
  source: AuditSource;
  correlation_id: string | null;
  request_id: string | null;
  changes: AuditChange[] | null;
  missing_actor_context: boolean;
  audit_event_organisations?: Array<{ org_id: string; org_name: string | null }>;
};

const AUDIT_SELECT = "id,occurred_at,action,entity_type,entity_id,entity_label,actor_user_id,actor_display_name,actor_email,actor_role,actor_type,actor_org_id,source,correlation_id,request_id,changes,missing_actor_context,audit_event_organisations(org_id,org_name)";

function normalizeEvent(row: RawAuditEvent): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    actorType: row.actor_type,
    actorOrgId: row.actor_org_id,
    source: row.source,
    correlationId: row.correlation_id,
    requestId: row.request_id,
    changes: Array.isArray(row.changes) ? row.changes : [],
    missingActorContext: row.missing_actor_context,
    organisations: (row.audit_event_organisations ?? []).map(scope => ({
      id: scope.org_id,
      name: scope.org_name ?? "Ukendt organisation",
    })),
  };
}

export async function fetchAuditEvents(
  db: SupabaseClient,
  caller: AdminCaller,
  filters: AuditFilters,
  limit = 50,
): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  const isSuperadmin = caller.role === "superadmin";
  const requestedOrg = isSuperadmin ? filters.orgId : caller.orgId;
  const select = requestedOrg
    ? AUDIT_SELECT.replace("audit_event_organisations(", "audit_event_organisations!inner(")
    : AUDIT_SELECT;
  let query = db.from("audit_events").select(select)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit + 1);

  if (filters.from && !Number.isNaN(Date.parse(filters.from))) query = query.gte("occurred_at", new Date(filters.from).toISOString());
  if (filters.to && !Number.isNaN(Date.parse(filters.to))) {
    const inclusiveTo = /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? `${filters.to}T23:59:59.999Z` : new Date(filters.to).toISOString();
    query = query.lte("occurred_at", inclusiveTo);
  }
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.role) query = query.eq("actor_role", filters.role);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.source) query = query.eq("source", filters.source);
  if (requestedOrg) query = query.eq("audit_event_organisations.org_id", requestedOrg);
  const search = filters.query ? sanitizeAuditSearch(filters.query) : "";
  if (search) query = query.or(`entity_label.ilike.%${search}%,entity_id.ilike.%${search}%,actor_display_name.ilike.%${search}%,actor_email.ilike.%${search}%`);
  const cursor = decodeAuditCursor(filters.cursor);
  if (cursor) query = query.or(`occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RawAuditEvent[];
  const hasMore = rows.length > safeLimit;
  const pageRows = rows.slice(0, safeLimit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(normalizeEvent),
    nextCursor: hasMore && last ? encodeAuditCursor({ occurredAt: last.occurred_at, id: last.id }) : null,
  };
}

const SENSITIVE_KEY = /(password|token|secret|key|cpr|bank|account|konto|credential|body|message|content|html|email|phone|address|note)/i;

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeMetadata(item),
  ]));
}

export async function recordAuditEvent(input: {
  context: AuditContext;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  orgIds?: string[];
  changes?: AuditChange[];
  metadata?: Record<string, unknown>;
  actorType?: "user" | "system" | "integration";
}) {
  const db = createServiceClient({ audit: input.context });
  let actorName: string | null = null;
  let actorEmail: string | null = null;
  if (input.context.actorUserId) {
    const [{ data: authResult }, { data: holder }] = await Promise.all([
      db.auth.admin.getUserById(input.context.actorUserId),
      db.from("rettighedshavere").select("full_name").eq("user_id", input.context.actorUserId).limit(1).maybeSingle(),
    ]);
    actorEmail = authResult.user?.email ?? null;
    actorName = holder?.full_name ?? actorEmail;
  }
  const { data: event, error } = await db.from("audit_events").insert({
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    entity_label: input.entityLabel ?? input.entityId ?? null,
    actor_user_id: input.context.actorUserId ?? null,
    actor_display_name: actorName,
    actor_email: actorEmail,
    actor_role: input.context.actorRole ?? null,
    actor_type: input.actorType ?? (input.context.actorUserId ? "user" : input.context.source === "cron" || input.context.source === "import" ? "integration" : "system"),
    actor_org_id: input.context.actorOrgId ?? null,
    source: input.context.source,
    correlation_id: input.context.correlationId ?? null,
    changes: input.changes ?? [],
    metadata: sanitizeMetadata(input.metadata ?? {}),
    missing_actor_context: !input.context.actorUserId && input.context.source === "api",
  }).select("id").single();
  if (error || !event) throw new Error(error?.message ?? "Audit event could not be recorded");
  const orgIds = [...new Set([...(input.orgIds ?? []), input.context.actorOrgId].filter((id): id is string => Boolean(id)))];
  if (orgIds.length) {
    const scopeResult = await db.from("audit_event_organisations").insert(orgIds.map(orgId => ({ event_id: event.id, org_id: orgId })));
    if (scopeResult.error) throw new Error(scopeResult.error.message);
  }
  return event.id;
}
