import { NextRequest, NextResponse } from "next/server";
import { isAuditAction, isAuditSource, type AuditFilters } from "@/lib/audit-log";
import { fetchAuditEvents } from "@/lib/audit-log-server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { z } from "zod";

export const dynamic = "force-dynamic";

function parseFilters(req: NextRequest): AuditFilters {
  const params = req.nextUrl.searchParams;
  const action = params.get("action");
  const source = params.get("source");
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    orgId: params.get("orgId") ?? undefined,
    actorUserId: params.get("actorUserId") ?? undefined,
    role: params.get("role")?.slice(0, 50) || undefined,
    action: isAuditAction(action) ? action : undefined,
    entityType: params.get("entityType")?.slice(0, 100) || undefined,
    source: isAuditSource(source) ? source : undefined,
    targetMemberUuid: z.string().uuid().safeParse(params.get("targetMemberUuid")).data,
    purposeCode: params.get("purposeCode")?.slice(0, 80) || undefined,
    systemComponent: params.get("systemComponent")?.slice(0, 120) || undefined,
    outcome: z.enum(["success", "denied", "failed", "partial"]).safeParse(params.get("outcome")).data,
    query: params.get("query")?.slice(0, 100) || undefined,
    cursor: params.get("cursor") ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  const db = await createClient();
  const caller = await assertAdminRole(db, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  try {
    const filters = parseFilters(req);
    const memberQuery = caller.role === "superadmin"
      ? db.from("rettighedshavere").select("id,full_name").order("full_name").limit(500)
      : db.from("rettighedshavere").select("id,full_name,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", caller.orgId).order("full_name").limit(500);
    const [{ items, nextCursor }, { data: organisations }, { data: actorRows }, { data: memberRows }] = await Promise.all([
      fetchAuditEvents(db, caller, filters, 50),
      caller.role === "superadmin"
        ? db.from("organisations").select("id,name").order("name")
        : db.from("organisations").select("id,name").eq("id", caller.orgId),
      db.from("audit_events")
        .select("actor_user_id,actor_display_name,actor_email")
        .not("actor_user_id", "is", null)
        .order("occurred_at", { ascending: false })
        .limit(500),
      memberQuery,
    ]);
    const actorMap = new Map<string, { id: string; name: string }>();
    for (const actor of actorRows ?? []) {
      if (actor.actor_user_id && !actorMap.has(actor.actor_user_id)) {
        actorMap.set(actor.actor_user_id, {
          id: actor.actor_user_id,
          name: actor.actor_display_name || actor.actor_email || actor.actor_user_id,
        });
      }
    }
    return NextResponse.json({
      items,
      nextCursor,
      organisations: organisations ?? [],
      actors: [...actorMap.values()],
      members: (memberRows ?? []).map(member => ({ id: member.id, name: member.full_name })),
      purposes: [...new Set(items.map(item => item.purposeCode).filter((value): value is string => Boolean(value)))].sort(),
      components: [...new Set(items.map(item => item.systemComponent).filter((value): value is string => Boolean(value)))].sort(),
      callerRole: caller.role,
      callerOrgId: caller.orgId,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[audit-log] Audit events could not be loaded", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Logningen kunne ikke hentes" }, { status: 500 });
  }
}
