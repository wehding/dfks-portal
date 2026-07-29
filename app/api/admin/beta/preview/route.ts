import { NextRequest, NextResponse } from "next/server";
import { GLOBAL_ROLES } from "@/lib/admin-roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

type InviteRow = { name?: unknown; email?: unknown; role?: unknown };

export async function POST(request: NextRequest) {
  const caller = await assertAdminRole(await createClient(), GLOBAL_ROLES);
  if (!caller) return NextResponse.json({ error: "Kun superadmin kan forberede betatest." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const orgId = typeof body.orgId === "string" && /^[0-9a-f-]{36}$/i.test(body.orgId) ? body.orgId : "";
  if (!orgId) return NextResponse.json({ error: "Vælg en gyldig testorganisation." }, { status: 400 });
  const db = createServiceClient();
  const { data: org } = await db.from("organisations").select("id,name,beta_test_mode").eq("id", orgId).maybeSingle();
  if (!org?.beta_test_mode) return NextResponse.json({ error: "Organisationen er ikke markeret som betatestorganisation." }, { status: 409 });

  const { data: works, error: workError } = await db.from("works")
    .select("id,title,year,status").eq("org_id", orgId).eq("is_test_data", true).order("title");
  if (workError) return NextResponse.json({ error: workError.message }, { status: 500 });
  const workIds = (works ?? []).map(work => work.id as string);
  const [{ count: assignmentCount }, { count: contractCount }] = await Promise.all([
    workIds.length ? db.from("work_assignments").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("work_id", workIds) : Promise.resolve({ count: 0 }),
    workIds.length ? db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("work_id", workIds) : Promise.resolve({ count: 0 }),
  ]);

  const invitations = Array.isArray(body.invitations) ? body.invitations.slice(0, 100) as InviteRow[] : [];
  const normalized = invitations.map((row, index) => ({
    row: index + 1,
    name: typeof row.name === "string" ? row.name.trim() : "",
    email: typeof row.email === "string" ? row.email.trim().toLowerCase() : "",
    role: typeof row.role === "string" ? row.role.trim() : "member",
  }));
  const emails = normalized.map(row => row.email).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const { data: existingHolders } = emails.length
    ? await db.from("rettighedshavere").select("id,full_name,email").in("email", emails)
    : { data: [] };
  const existingMap = new Map((existingHolders ?? []).map(holder => [String(holder.email).toLowerCase(), holder]));
  const seen = new Set<string>();
  const invitationPreview = normalized.map(row => {
    const errors: string[] = [];
    if (!row.name) errors.push("Navn mangler");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("Ugyldig e-mail");
    if (seen.has(row.email)) errors.push("Dublet i listen");
    seen.add(row.email);
    return { ...row, errors, existingRightsHolder: existingMap.get(row.email) ?? null, action: existingMap.has(row.email) ? "reuse" : "invite" };
  });

  return NextResponse.json({
    organisation: { id: org.id, name: org.name },
    cleanup: { works: works ?? [], workCount: workIds.length, assignmentCount: assignmentCount ?? 0, contractCount: contractCount ?? 0, destructiveActionPerformed: false },
    invitations: invitationPreview,
    invitationSendPerformed: false,
  });
}
