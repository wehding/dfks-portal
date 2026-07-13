"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

import { requireOrgId } from "@/lib/org";
const FORENINGLET_BASE = "https://foreninglet.dk/api/members";

type ForeningLetMember = {
  id?: string | number;
  display_id?: string | number | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  [key: string]: unknown;
};

function authHeader() {
  const username = process.env.FORENINGLET_USERNAME;
  const password = process.env.FORENINGLET_PASSWORD;
  if (!username || !password) {
    throw new Error("ForeningLet-login mangler i miljøet.");
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function currentAdminOrgId(userId: string) {
  const admin = createServiceClient();
  const { data } = await admin
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", userId)
    .in("role", ["superadmin", "admin", "org-admin"])
    .limit(1)
    .maybeSingle();
  if (data?.org_id) return data.org_id;
  return requireOrgId(admin, userId);
}

async function fetchMembers(path: string, status: "active" | "resigned") {
  const res = await fetch(`${FORENINGLET_BASE}${path}?version=1`, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (res.status === 429) {
    throw new Error("ForeningLet afviser kaldet på grund af rate limit. Prøv igen senere.");
  }
  if (!res.ok) {
    throw new Error(`ForeningLet svarede med ${res.status}.`);
  }

  const json = await res.json();
  const members = Array.isArray(json) ? json : Array.isArray(json.members) ? json.members : [];
  return members.map((member: ForeningLetMember) => ({ ...member, status }));
}

export async function syncDfksMembers() {
  const sessionClient = await createClient();
  const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Du har ikke adgang til at opdatere medlemslisten." };

  try {
    const orgId = await currentAdminOrgId(caller.userId);
    const now = new Date().toISOString();
    const activeMembers = await fetchMembers("", "active");
    let resignedMembers: Array<ForeningLetMember & { status: "resigned" }> = [];

    try {
      resignedMembers = await fetchMembers("/status/resigned", "resigned");
    } catch {
      resignedMembers = [];
    }

    const rows = [...activeMembers, ...resignedMembers]
      .filter(member => member.id !== undefined && member.id !== null)
      .map(member => {
        const firstName = String(member.first_name ?? "").trim();
        const lastName = String(member.last_name ?? "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Ukendt medlem";
        return {
          org_id: orgId,
          foreninglet_id: String(member.id),
          display_id: member.display_id == null ? null : String(member.display_id),
          first_name: firstName || null,
          last_name: lastName || null,
          full_name: fullName,
          email: typeof member.email === "string" ? member.email : null,
          status: member.status,
          raw: member,
          synced_at: now,
          updated_at: now,
        };
      });

    if (rows.length === 0) {
      return { success: false, error: "ForeningLet returnerede ingen medlemmer." };
    }

    const admin = createServiceClient();
    const { error } = await admin
      .from("dfks_members")
      .upsert(rows, { onConflict: "org_id,foreninglet_id" });

    if (error) return { success: false, error: error.message };
    return { success: true, count: rows.length, syncedAt: now };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke opdatere medlemslisten." };
  }
}

export async function getDfksMembersSyncStatus() {
  const sessionClient = await createClient();
  const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Du har ikke adgang til medlemslisten." };

  const orgId = await currentAdminOrgId(caller.userId);
  const admin = createServiceClient();
  const { count, error: countError } = await admin
    .from("dfks_members")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (countError) return { success: false, error: countError.message };

  const { data, error } = await admin
    .from("dfks_members")
    .select("synced_at")
    .eq("org_id", orgId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { success: false, error: error.message };

  return { success: true, count: count ?? 0, syncedAt: data?.synced_at ?? null };
}
