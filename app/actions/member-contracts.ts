"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";
const BUCKET = "kontrakter"; // samme bucket som admin-validering

type ContractExtractData = {
  contractType?: string | null;
  isFreelanceContract?: boolean | null;
  overenskomst?: string | null;
  contractDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function assertAdminForOrg(db: ReturnType<typeof createServiceClient>, userId: string, orgId: string) {
  const { data } = await db
    .from("user_org_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId);
  return (data ?? []).some(row => ADMIN_ROLES.includes(row.role));
}

export async function uploadMemberContract(formData: FormData) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const { data: orgRole } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const orgId = orgRole?.org_id ?? DFKS_ORG_ID;

  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "Ingen fil modtaget" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "docx", "txt"].includes(ext)) {
    return { success: false, error: "Filformat ikke understøttet — brug PDF, DOCX eller TXT" };
  }

  // Upload til kontrakter-bucket (samme som admin)
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_æøåÆØÅ]/g, "_");
  const pdfUrl = `${user.id}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: storageErr } = await db.storage
    .from(BUCKET)
    .upload(pdfUrl, buffer, { contentType: file.type || "application/octet-stream" });

  if (storageErr) {
    console.error("Storage upload fejl:", storageErr);
    return { success: false, error: "Kunne ikke uploade filen" };
  }

  // Kald eksisterende AI-extract route (genbruger al Claude-logik)
  let aiData: ContractExtractData = {};
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const extractForm = new FormData();
    extractForm.append("file", new Blob([buffer], { type: file.type }), file.name);

    const res = await fetch(`${baseUrl}/api/contracts/extract`, {
      method: "POST",
      body: extractForm,
    });

    if (res.ok) {
      aiData = await res.json() as ContractExtractData;
    } else {
      console.warn("Extract route returnerede:", res.status);
    }
  } catch (err: unknown) {
    console.error("AI-udtræk fejl:", err instanceof Error ? err.message : err);
    // Fortsæt uden AI-data — kontrakten gemmes stadig
  }

  // Gem kontrakt i DB — status "kladde" så admin kan validere via eksisterende flow
  const { data: contract, error: dbErr } = await db
    .from("contracts")
    .insert({
      org_id: orgId,
      rights_holder_id: rh.id,
      pdf_url: pdfUrl,
      type: aiData.contractType === "leverandør" || aiData.isFreelanceContract ? "leverandør" : "a-løn",
      overenskomst: aiData.overenskomst ?? null,
      contract_date: aiData.contractDate?.substring(0, 10) ?? null,
      start_date: aiData.startDate?.substring(0, 10) ?? null,
      end_date: aiData.endDate?.substring(0, 10) ?? null,
      status: "kladde",
    })
    .select("id")
    .single();

  if (dbErr || !contract) {
    console.error("DB insert fejl:", dbErr);
    // Ryd op i storage ved DB-fejl
    await db.storage.from(BUCKET).remove([pdfUrl]);
    return { success: false, error: "Kunne ikke gemme kontrakten" };
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, contractId: contract.id, aiData };
}

export async function saveUploadedContract(params: {
  filePath: string;
  orgId: string;
  rhId: string;
  memberName: string;
  workTitle: string;
  workId?: string;
  category: string;
  roles: string[];
  duration?: number;
  premiereDate?: string;
  episodes?: { number: number; role: string }[];
}) {
  const db = createServiceClient();

  const { data: saved, error: dbErr } = await db
    .from("contracts")
    .insert({
      org_id: params.orgId,
      rights_holder_id: params.rhId,
      type: "a-løn",
      status: "kladde",
      pdf_url: params.filePath,
      working_title: params.workTitle || null,
      work_id: params.workId ?? null,
    })
    .select()
    .single();

  if (dbErr || !saved) return { success: false, error: dbErr?.message ?? "Kunne ikke gemme kontrakten" };

  const { error: validationError } = await db.from("contract_validations").insert({
    contract_id: saved.id,
    org_id: params.orgId,
    notes: JSON.stringify({
      memberName: params.memberName,
      workTitle: params.workTitle,
      workId: params.workId,
      productionType: params.category || undefined,
      creditedRoles: params.roles,
      duration: params.duration,
      premiereDate: params.premiereDate,
      episodes: params.episodes,
      submittedByMember: true,
    }),
  });

  if (validationError) {
    await db.from("contracts").delete().eq("id", saved.id);
    await db.storage.from(BUCKET).remove([params.filePath]);
    return { success: false, error: validationError.message };
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, contract: saved };
}

export async function linkContractToWork(contractId: string, workId: string | null) {
  const supabase = await createClient();
  const db = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  const { error } = await db
    .from("contracts")
    .update({ work_id: workId })
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function getContractSignedUrl(pdfUrl: string) {
  const db = createServiceClient();
  const { data } = await db.storage.from(BUCKET).createSignedUrl(pdfUrl, 3600);
  return { url: data?.signedUrl ?? null };
}

export async function deleteMemberContract(contractId: string) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("pdf_url, rights_holder_id")
    .eq("id", contractId)
    .single();

  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (contract.rights_holder_id !== rh.id) return { success: false, error: "Ikke autoriseret" };

  if (contract.pdf_url) {
    await db.storage.from(BUCKET).remove([contract.pdf_url]);
  }

  await db.from("contracts").delete().eq("id", contractId);

  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function getContractValidation(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", contractId).single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  const { data } = await db
    .from("contract_validations")
    .select("extracted_data")
    .eq("contract_id", contractId)
    .maybeSingle();
  return { success: true, extractedData: (data?.extracted_data ?? null) as Record<string, unknown> | null };
}

export async function saveContractValidation(params: { contractId: string; extractedData: Record<string, unknown> }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", params.contractId).single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const ed = params.extractedData as Record<string, unknown>;
  const { error } = await db.from("contract_validations").upsert(
    {
      contract_id: params.contractId,
      org_id: contract.org_id,
      holiday_pay_rate: (ed.holidayPayRate as number) ?? null,
      beta_rate: (ed.betaRate as number) ?? null,
      has_overenskomst_incorporation: !!ed.collectiveAgreement,
      has_credit_clause: !!ed.creditedRoles,
      notes: (ed.specialNotes as string) ?? null,
      extracted_data: ed,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    },
    { onConflict: "contract_id" }
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/kontrakter");
  revalidatePath("/admin/validering");
  return { success: true };
}

export async function deleteAdminContractsPermanently(contractIds: string[]) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const ids = [...new Set(contractIds.filter(Boolean))];
  if (ids.length === 0) return { success: false, error: "Ingen kontrakter valgt" };

  const db = createServiceClient();
  const { data: rows, error: fetchErr } = await db
    .from("contracts")
    .select("id, org_id, pdf_url")
    .in("id", ids);
  if (fetchErr) return { success: false, error: fetchErr.message };

  const found = rows ?? [];
  if (found.length === 0) return { success: false, error: "Ingen af kontrakterne blev fundet" };

  // Admin skal have rettigheder i hver org kontrakterne tilhører
  const orgIds = [...new Set(found.map(row => row.org_id))];
  for (const orgId of orgIds) {
    if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  }

  // Masse-sletning af mere end 20 kontrakter kræver superadmin (server-side spærre)
  if (found.length > 20) {
    const { data: superRows } = await db
      .from("user_org_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "superadmin")
      .limit(1);
    if (!superRows || superRows.length === 0) {
      return { success: false, error: "Kun superadmin kan slette mere end 20 kontrakter ad gangen." };
    }
  }

  const pdfs = found.map(row => row.pdf_url).filter((url): url is string => Boolean(url));
  if (pdfs.length > 0) await db.storage.from(BUCKET).remove(pdfs);

  // Slet i batches så store cascade-sletninger ikke rammer statement-timeout
  const foundIds = found.map(row => row.id);
  for (let i = 0; i < foundIds.length; i += 50) {
    const chunk = foundIds.slice(i, i + 50);
    const { error } = await db.from("contracts").delete().in("id", chunk);
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/admin/kontrakter");
  return { success: true, deletedCount: foundIds.length };
}

export async function addMemberContractComment(contractId: string, message: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const text = message.trim();
  if (!text) return { success: false, error: "Skriv en kommentar først." };

  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract || contract.rights_holder_id !== rh.id) return { success: false, error: "Kontrakt ikke fundet" };

  const { data: comment, error } = await db
    .from("contract_comments")
    .insert({
      org_id: contract.org_id,
      contract_id: contract.id,
      author_user_id: user.id,
      author_role: "member",
      message: text,
      member_read_at: new Date().toISOString(),
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();

  if (error || !comment) return { success: false, error: error?.message ?? "Kunne ikke gemme kommentaren" };
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true, comment };
}

export async function addAdminContractComment(contractId: string, message: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const text = message.trim();
  if (!text) return { success: false, error: "Skriv et svar først." };

  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const { data: comment, error } = await db
    .from("contract_comments")
    .insert({
      org_id: contract.org_id,
      contract_id: contract.id,
      author_user_id: user.id,
      author_role: "admin",
      message: text,
      admin_read_at: new Date().toISOString(),
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();

  if (error || !comment) return { success: false, error: error?.message ?? "Kunne ikke gemme svaret" };
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true, comment };
}

export async function markContractCommentsRead(contractId: string, viewerRole: "admin" | "member" = "member") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };

  const now = new Date().toISOString();

  // Rollen bestemmes af HVILKEN side der kalder (admin vs portal), ikke af hvem
  // brugeren er — ellers fejler mark-læst når admin selv er rettighedshaveren.
  if (viewerRole === "admin") {
    if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  } else {
    const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
    if (!rh || rh.id !== contract.rights_holder_id) return { success: false, error: "Ikke autoriseret" };
  }

  const asMember = viewerRole === "member";
  // Medlem markerer admin-beskeder læst; admin markerer medlem-beskeder læst.
  const query = db
    .from("contract_comments")
    .update(asMember ? { member_read_at: now } : { admin_read_at: now })
    .eq("contract_id", contractId)
    .eq("author_role", asMember ? "admin" : "member")
    .is(asMember ? "member_read_at" : "admin_read_at", null);

  const { error } = await query;
  if (error) return { success: false, error: error.message };

  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true };
}
