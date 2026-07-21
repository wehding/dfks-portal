"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { encryptValue } from "@/lib/encryption";
import { resolveForeningLetCredentials } from "@/lib/org-integrations";
import { normalizeForeningLetMember, parseForeningLetMemberPayload, type NormalizedForeningLetMember } from "@/lib/foreninglet";

import { requireOrgId } from "@/lib/org";

type ForeningLetMember = NormalizedForeningLetMember & { status: "active" | "resigned" };

type CachedDfksMember = {
  id: string;
  org_id: string | null;
  foreninglet_id: string;
  display_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  status: string;
  raw: Record<string, unknown> | null;
};

type ImportCandidate = {
  id: string;
  full_name: string;
  email: string | null;
  display_id: string | null;
  status: string;
  phone: string | null;
  address: string | null;
  match: "new" | "existing" | "ambiguous";
  rights_holder_id: string | null;
  match_reason: string | null;
};

function authHeader(username: string, password: string) {
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getMemberPhone(member: ForeningLetMember | CachedDfksMember) {
  const raw = ("raw" in member ? member.raw ?? {} : member) as Record<string, unknown>;
  return stringValue(raw.mobile) ?? stringValue(raw.phone) ?? null;
}

function getMemberAddress(member: ForeningLetMember | CachedDfksMember) {
  const raw = ("raw" in member ? member.raw ?? {} : member) as Record<string, unknown>;
  const address = stringValue(raw.address) ?? stringValue(raw.street) ?? stringValue(raw.address1);
  const zip = stringValue(raw.zipcode) ?? stringValue(raw.zip);
  const city = stringValue(raw.city);
  return [address, [zip, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
}

function getMemberCpr(member: ForeningLetMember | CachedDfksMember) {
  const raw = ("raw" in member ? member.raw ?? {} : member) as Record<string, unknown>;
  return stringValue(raw.cpr_no) ?? stringValue(raw.cpr) ?? stringValue(raw.social_security_number) ?? null;
}

async function fetchMembers<TStatus extends "active" | "resigned">(
  baseUrl: string,
  username: string,
  password: string,
  path: string,
  status: TStatus
): Promise<Array<NormalizedForeningLetMember & { status: TStatus }>> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  url.searchParams.set("version", "1");
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader(username, password),
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
  return parseForeningLetMemberPayload(json)
    .map(normalizeForeningLetMember)
    .filter((member): member is NormalizedForeningLetMember => member !== null)
    .map(member => ({ ...member, status }));
}

function findExistingMemberMatch(
  member: CachedDfksMember,
  holders: Array<{ id: string; full_name: string; email: string | null; org_affiliations?: Array<{ member_no: string | null }> | null }>
): { id: string | null; reason: string | null; ambiguous: boolean } {
  const email = normalize(member.email);
  const memberNo = normalize(member.display_id);
  const name = normalize(member.full_name);

  const emailMatches = email ? holders.filter(holder => normalize(holder.email) === email) : [];
  if (emailMatches.length === 1) return { id: emailMatches[0].id, reason: "Matcher på email", ambiguous: false };
  if (emailMatches.length > 1) return { id: null, reason: "Flere matcher samme email", ambiguous: true };

  const memberNoMatches = memberNo
    ? holders.filter(holder => (holder.org_affiliations ?? []).some(aff => normalize(aff.member_no) === memberNo))
    : [];
  if (memberNoMatches.length === 1) return { id: memberNoMatches[0].id, reason: "Matcher på medlemsnummer", ambiguous: false };
  if (memberNoMatches.length > 1) return { id: null, reason: "Flere matcher samme medlemsnummer", ambiguous: true };

  const nameMatches = name ? holders.filter(holder => normalize(holder.full_name) === name) : [];
  if (nameMatches.length === 1) return { id: nameMatches[0].id, reason: "Matcher på navn", ambiguous: false };
  if (nameMatches.length > 1) return { id: null, reason: "Flere matcher samme navn", ambiguous: true };

  return { id: null, reason: null, ambiguous: false };
}

async function loadImportCandidates(orgId: string): Promise<ImportCandidate[]> {
  const admin = createServiceClient();
  const [{ data: members, error: membersError }, { data: holders, error: holdersError }] = await Promise.all([
    admin
      .from("dfks_members")
      .select("id, org_id, foreninglet_id, display_id, first_name, last_name, full_name, email, status, raw")
      .eq("org_id", orgId)
      .order("full_name"),
    admin
      .from("rettighedshavere")
      .select("id, full_name, email, org_affiliations!inner(member_no, org_id)")
      .eq("org_affiliations.org_id", orgId),
  ]);

  if (membersError) throw new Error(membersError.message);
  if (holdersError) throw new Error(holdersError.message);

  return ((members ?? []) as CachedDfksMember[]).map(member => {
    const match = findExistingMemberMatch(member, (holders ?? []) as Array<{ id: string; full_name: string; email: string | null; org_affiliations?: Array<{ member_no: string | null }> | null }>);
    return {
      id: member.id,
      full_name: member.full_name,
      email: member.email,
      display_id: member.display_id,
      status: member.status,
      phone: getMemberPhone(member),
      address: getMemberAddress(member),
      match: match.ambiguous ? "ambiguous" : match.id ? "existing" : "new",
      rights_holder_id: match.id,
      match_reason: match.reason,
    };
  });
}

async function updateExistingMemberships(orgId: string) {
  const admin = createServiceClient();
  const candidates = await loadImportCandidates(orgId);
  let updated = 0;
  for (const candidate of candidates) {
    if (!candidate.rights_holder_id || candidate.match === "ambiguous") continue;
    const isActive = candidate.status !== "resigned";
    const { error } = await admin
      .from("org_affiliations")
      .update({
        is_member: isActive,
        member_no: candidate.display_id,
        valid_to: isActive ? null : new Date().toISOString().slice(0, 10),
      })
      .eq("org_id", orgId)
      .eq("rights_holder_id", candidate.rights_holder_id);
    if (!error) updated += 1;
  }
  return updated;
}

export async function syncDfksMembers() {
  const sessionClient = await createClient();
  const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Du har ikke adgang til at opdatere medlemslisten." };

  try {
    const orgId = await currentAdminOrgId(caller.userId);
    const credentials = await resolveForeningLetCredentials(createServiceClient(), orgId);
    const now = new Date().toISOString();
    const activeMembers = await fetchMembers(credentials.baseUrl, credentials.username, credentials.password, "", "active");
    let resignedMembers: Array<ForeningLetMember & { status: "resigned" }> = [];

    try {
      resignedMembers = await fetchMembers(credentials.baseUrl, credentials.username, credentials.password, "/status/resigned", "resigned");
    } catch {
      resignedMembers = [];
    }

    const rows = [...activeMembers, ...resignedMembers]
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
          raw: member.raw,
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
    const updatedExisting = await updateExistingMemberships(orgId);
    const candidates = await loadImportCandidates(orgId);
    return {
      success: true,
      count: rows.length,
      syncedAt: now,
      updatedExisting,
      newCount: candidates.filter(candidate => candidate.match === "new" && candidate.status !== "resigned").length,
      existingCount: candidates.filter(candidate => candidate.match === "existing").length,
      ambiguousCount: candidates.filter(candidate => candidate.match === "ambiguous").length,
      source: credentials.source,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke opdatere medlemslisten." };
  }
}

export async function getDfksMemberImportPreview() {
  const sessionClient = await createClient();
  const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Du har ikke adgang til medlemslisten.", candidates: [] as ImportCandidate[] };

  try {
    const orgId = await currentAdminOrgId(caller.userId);
    const candidates = await loadImportCandidates(orgId);
    return { success: true, candidates };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke hente importlisten.", candidates: [] as ImportCandidate[] };
  }
}

export async function importDfksMembersToRightsHolders(memberIds: string[]) {
  const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst ét medlem.", created: 0, updated: 0, skipped: 0 };

  const sessionClient = await createClient();
  const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Du har ikke adgang til at importere medlemmer.", created: 0, updated: 0, skipped: 0 };

  try {
    const orgId = await currentAdminOrgId(caller.userId);
    const admin = createServiceClient();
    const candidates = await loadImportCandidates(orgId);
    const selected = candidates.filter(candidate => uniqueIds.includes(candidate.id));
    const { data: members, error } = await admin
      .from("dfks_members")
      .select("id, org_id, foreninglet_id, display_id, first_name, last_name, full_name, email, status, raw")
      .in("id", selected.map(candidate => candidate.id))
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);

    const memberById = new Map(((members ?? []) as CachedDfksMember[]).map(member => [member.id, member]));
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of selected) {
      if (candidate.match === "ambiguous") {
        skipped += 1;
        continue;
      }
      const member = memberById.get(candidate.id);
      if (!member) {
        skipped += 1;
        continue;
      }
      const isActive = member.status !== "resigned";
      const payload = {
        full_name: member.full_name,
        email: member.email,
        phone: getMemberPhone(member),
        address: getMemberAddress(member),
        cpr_no: encryptValue(getMemberCpr(member)),
      };

      if (candidate.rights_holder_id) {
        const { error: holderError } = await admin
          .from("rettighedshavere")
          .update(payload)
          .eq("id", candidate.rights_holder_id);
        if (holderError) throw new Error(holderError.message);
        const { error: affError } = await admin
          .from("org_affiliations")
          .upsert({
            org_id: orgId,
            rights_holder_id: candidate.rights_holder_id,
            is_member: isActive,
            member_no: member.display_id,
            valid_to: isActive ? null : new Date().toISOString().slice(0, 10),
          }, { onConflict: "org_id,rights_holder_id" });
        if (affError) throw new Error(affError.message);
        updated += 1;
        continue;
      }

      if (!isActive) {
        skipped += 1;
        continue;
      }

      const { data: createdHolder, error: createError } = await admin
        .from("rettighedshavere")
        .insert(payload)
        .select("id")
        .single();
      if (createError || !createdHolder) throw new Error(createError?.message ?? "Kunne ikke oprette rettighedshaver.");

      const { error: affError } = await admin
        .from("org_affiliations")
        .insert({
          org_id: orgId,
          rights_holder_id: createdHolder.id,
          is_member: true,
          member_no: member.display_id,
        });
      if (affError) throw new Error(affError.message);
      created += 1;
    }

    return { success: true, created, updated, skipped };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke importere medlemmer.", created: 0, updated: 0, skipped: 0 };
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
