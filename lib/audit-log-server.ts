import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeAuditCursor,
  encodeAuditCursor,
  AUDIT_DETAIL_ENTITY_TYPES,
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
  else query = query.not("entity_type", "in", `(${AUDIT_DETAIL_ENTITY_TYPES.join(",")})`);
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeMetadata(item),
  ]));
}

function safeUuid(value: string | null | undefined) {
  return value && UUID_PATTERN.test(value) ? value : null;
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
  targetMemberId?: string | null;
  purposeCode?: string | null;
  legalBasis?: string | null;
  dataCategories?: string[];
  outcome?: "success" | "denied" | "failed" | "partial";
  errorCode?: string | null;
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
  const orgIds = [...new Set([...(input.orgIds ?? []), input.context.actorOrgId].filter((id): id is string => Boolean(id)))];
  const { data: eventId, error } = await db.rpc("append_audit_event", {
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_entity_label: input.entityLabel ?? input.entityId ?? null,
    p_actor_user_id: input.context.actorUserId ?? null,
    p_actor_display_name: actorName,
    p_actor_email: actorEmail,
    p_actor_role: input.context.actorRole ?? null,
    p_actor_type: input.actorType ?? (input.context.actorUserId ? "user" : input.context.source === "cron" || input.context.source === "import" ? "integration" : "system"),
    p_actor_org_id: input.context.actorOrgId ?? null,
    p_source: input.context.source,
    p_correlation_id: safeUuid(input.context.correlationId),
    p_request_id: input.context.requestId ?? null,
    p_changes: input.changes ?? [],
    p_metadata: sanitizeMetadata(input.metadata ?? {}),
    p_missing_actor_context: !input.context.actorUserId && input.context.source === "api",
    p_target_member_uuid: safeUuid(input.targetMemberId),
    p_purpose_code: input.purposeCode ?? null,
    p_legal_basis: input.legalBasis ?? null,
    p_data_categories: input.dataCategories ?? [],
    p_ip_address: input.context.ipAddress ?? null,
    p_system_component: input.context.systemComponent ?? null,
    p_outcome: input.outcome ?? "success",
    p_error_code: input.errorCode ?? null,
    p_org_ids: orgIds,
  });
  if (error || !eventId) throw new Error(error?.message ?? "Audit event could not be recorded");
  return eventId;
}
