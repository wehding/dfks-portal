"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function isUserAdmin(userId: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("user_org_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some(row => ADMIN_ROLES.includes(row.role));
}

async function userOrgId(userId: string) {
  const db = createServiceClient();
  const { data } = await db.from("user_org_roles").select("org_id").eq("user_id", userId).limit(1).maybeSingle();
  if (data?.org_id) return data.org_id;
  const { data: holder } = await db.from("rettighedshavere").select("org_id").eq("user_id", userId).maybeSingle();
  return holder?.org_id ?? null;
}

export async function fetchMemberScreeningOptions() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret", works: [], broadcasters: [] };
  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", works: [], broadcasters: [] };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const [{ data: assignments }, { data: broadcasters }] = await Promise.all([
    holder ? db.from("work_assignments").select("works(id,title,type,year)").eq("rights_holder_id", holder.id).eq("org_id", orgId) : Promise.resolve({ data: [] }),
    db.from("broadcasters").select("id,name,logo_path").or(`org_id.is.null,org_id.eq.${orgId}`).order("name"),
  ]);
  const works = (assignments ?? []).flatMap(row => row.works ? [row.works] : []);
  return { success: true, works, broadcasters: broadcasters ?? [] };
}

export async function fetchMemberScreeningClaims() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const { data: claims, error } = await db
    .from("screening_claims")
    .select(`
      *,
      works(type),
      screening_claim_comments(*)
    `)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fejl ved hentning af visningskrav:", error);
    return { success: false, error: error.message };
  }

  // Sorter kommentarer kronologisk
  const processed = (claims ?? []).map(c => ({
    ...c,
    screening_claim_comments: (c.screening_claim_comments ?? []).sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }));

  return { success: true, claims: processed };
}

export async function createScreeningClaim(params: {
  workId: string;
  broadcasterId?: string | null;
  title: string;
  channel: string;
  screeningDate: string;
  note?: string;
  season?: number | null;
  episode?: number | null;
  initialComment?: string;
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const { data: assignment } = holder ? await db.from("work_assignments").select("id").eq("org_id", orgId).eq("rights_holder_id", holder.id).eq("work_id", params.workId).maybeSingle() : { data: null };
  if (!assignment) return { success: false, error: "Du kan kun indberette visninger på dine egne værker" };
  
  // Opret krav
  const { data: claim, error } = await db
    .from("screening_claims")
    .insert({
      profile_id: user.id,
      org_id: orgId,
      work_id: params.workId,
      broadcaster_id: params.broadcasterId ?? null,
      title: params.title,
      channel: params.channel,
      screening_date: params.screeningDate,
      season: params.season ?? null,
      episode: params.episode ?? null,
      status: "pending",
      note: params.note?.trim() || null,
    })
    .select()
    .single();

  if (error || !claim) {
    console.error("Fejl ved oprettelse af visningskrav:", error);
    return { success: false, error: error?.message ?? "Kunne ikke oprette indberetning" };
  }

  // Hvis der er en indledende kommentar, opret den
  if (params.initialComment?.trim()) {
    const { error: commentErr } = await db
      .from("screening_claim_comments")
      .insert({
        claim_id: claim.id,
        author_user_id: user.id,
        author_role: "member",
        message: params.initialComment.trim(),
      });

    if (commentErr) {
      console.error("Fejl ved oprettelse af indledende kommentar:", commentErr);
      await db.from("screening_claims").delete().eq("id", claim.id);
      return { success: false, error: commentErr.message };
    }
  }

  revalidatePath("/portal/mine-visninger");
  return { success: true, claim };
}

export async function addScreeningClaimComment(params: {
  claimId: string;
  message: string;
  authorRole: "member" | "admin";
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();

  const { data: claim } = await db.from("screening_claims").select("profile_id,org_id").eq("id", params.claimId).single();
  if (!claim) return { success: false, error: "Indberetningen findes ikke" };
  const admin = params.authorRole === "admin" && await isUserAdmin(user.id);
  const member = params.authorRole === "member" && claim.profile_id === user.id;
  if (!admin && !member) return { success: false, error: "Ikke autoriseret til dette krav" };
  if (!params.message.trim()) return { success: false, error: "Skriv en besked" };

  const { data: comment, error } = await db
    .from("screening_claim_comments")
    .insert({
      claim_id: params.claimId,
      author_user_id: user.id,
      author_role: params.authorRole,
      message: params.message.trim(),
      member_read_at: params.authorRole === "member" ? new Date().toISOString() : null,
      admin_read_at: params.authorRole === "admin" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    console.error("Fejl ved tilføjelse af kommentar:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/portal/mine-visninger");
  revalidatePath("/admin/aftalelicens");
  return { success: true, comment };
}

export async function markScreeningClaimCommentsRead(claimId: string, role: "member" | "admin") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const { data: claim } = await db.from("screening_claims").select("profile_id,org_id").eq("id", claimId).single();
  if (!claim) return { success: false, error: "Indberetningen findes ikke" };
  if (role === "member" && claim.profile_id !== user.id) return { success: false, error: "Ikke autoriseret" };
  if (role === "admin") {
    const orgId = await userOrgId(user.id);
    if (!(await isUserAdmin(user.id)) || orgId !== claim.org_id) return { success: false, error: "Ikke autoriseret" };
  }
  const now = new Date().toISOString();

  const updateField = role === "member" ? "member_read_at" : "admin_read_at";
  const searchRole = role === "member" ? "admin" : "member";

  const { error } = await db
    .from("screening_claim_comments")
    .update({ [updateField]: now })
    .eq("claim_id", claimId)
    .eq("author_role", searchRole)
    .is(updateField, null);

  if (error) {
    console.error("Fejl ved markering af kommentarer som læst:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function fetchAdminScreeningClaims() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const isAdmin = await isUserAdmin(user.id);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin" };

  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  
  // Hent alle krav og koble med profil og kommentarer
  const { data: claims, error } = await db
    .from("screening_claims")
    .select(`
      *,
      works(type),
      screening_claim_comments(*)
    `)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fejl ved hentning af admin visningskrav:", error);
    return { success: false, error: error.message };
  }

  // Sorter kommentarer kronologisk
  const processed = (claims ?? []).map(c => ({
    ...c,
    screening_claim_comments: (c.screening_claim_comments ?? []).sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }));

  return { success: true, claims: processed };
}

export async function updateScreeningClaimStatus(claimId: string, status: "approved" | "rejected") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const isAdmin = await isUserAdmin(user.id);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin" };

  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const { error } = await db
    .from("screening_claims")
    .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("org_id", orgId);

  if (error) {
    console.error("Fejl ved opdatering af kravstatus:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/portal/mine-visninger");
  revalidatePath("/admin/aftalelicens");
  return { success: true };
}
