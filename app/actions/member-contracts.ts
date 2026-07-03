"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";
const BUCKET = "kontrakter"; // samme bucket som admin-validering

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
  // Supabase Storage-nøgler tillader ikke æøå (afprøvet: giver "Invalid key") — erstat i stedet for at bevare
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
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
  let aiData: Record<string, any> = {};
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const extractForm = new FormData();
    extractForm.append("file", new Blob([buffer], { type: file.type }), file.name);

    const res = await fetch(`${baseUrl}/api/contracts/extract`, {
      method: "POST",
      body: extractForm,
    });

    if (res.ok) {
      aiData = await res.json();
    } else {
      console.warn("Extract route returnerede:", res.status);
    }
  } catch (err: any) {
    console.error("AI-udtræk fejl:", err.message);
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

  await db.from("contract_validations").insert({
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
