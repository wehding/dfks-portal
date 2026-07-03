"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const BUCKET = "kontrakter"; // samme bucket som kontrakter og admin-validering

export async function uploadMemberAttachment(contractId: string, formData: FormData) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  // Ejerskabstjek: kontrakten skal tilhøre den indloggede bruger
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();

  if (!contract || contract.rights_holder_id !== rh.id) {
    return { success: false, error: "Kontrakten tilhører ikke dig" };
  }

  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "Ingen fil modtaget" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "docx", "txt"].includes(ext)) {
    return { success: false, error: "Filformat ikke understøttet — brug PDF, DOCX eller TXT" };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_æøåÆØÅ]/g, "_");
  const pdfUrl = `${user.id}/allonger/${contractId}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: storageErr } = await db.storage
    .from(BUCKET)
    .upload(pdfUrl, buffer, { contentType: file.type || "application/octet-stream" });
  if (storageErr) {
    console.error("Storage upload fejl (allonge):", storageErr);
    return { success: false, error: "Kunne ikke uploade filen" };
  }

  const title = (formData.get("title") as string | null)?.trim() || file.name;

  const { data: attachment, error: dbErr } = await db
    .from("contract_attachments")
    .insert({
      contract_id: contractId,
      org_id: contract.org_id,
      type: "allonge",
      title,
      pdf_url: pdfUrl,
      created_by: user.id,
    })
    .select("id, type, title, pdf_url, created_at")
    .single();

  if (dbErr || !attachment) {
    console.error("DB insert fejl (allonge):", dbErr);
    await db.storage.from(BUCKET).remove([pdfUrl]);
    return { success: false, error: "Kunne ikke gemme allongen" };
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, attachment };
}

export async function deleteMemberAttachment(attachmentId: string) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  // Ejerskab er allerede sikret ved upload — created_by alene er tilstrækkeligt.
  // ai_status afgør om medlemmet stadig må slette selv: når admin har kørt
  // allonge-udtræk (ai_status = 'klar'), må kun admin slette den herefter.
  let attachment: { id: string; pdf_url: string | null; created_by: string | null; ai_status?: string | null } | null = null;

  const withStatus = await db
    .from("contract_attachments")
    .select("id, pdf_url, created_by, ai_status")
    .eq("id", attachmentId)
    .single();

  if (withStatus.error) {
    // Fald tilbage uden ai_status hvis migration 20260703210149 (ai_status/ai_result) endnu ikke er kørt
    console.warn("[member-attachments] ai_status ikke tilgængelig, falder tilbage:", withStatus.error.message);
    const fallback = await db
      .from("contract_attachments")
      .select("id, pdf_url, created_by")
      .eq("id", attachmentId)
      .single();
    attachment = fallback.data;
  } else {
    attachment = withStatus.data;
  }

  if (!attachment) return { success: false, error: "Allonge ikke fundet" };
  if (attachment.created_by !== user.id) return { success: false, error: "Ikke tilladt" };
  if (attachment.ai_status === "klar") {
    return { success: false, error: "Allongen er allerede valideret af DFKS og kan ikke længere slettes af dig — kontakt DFKS hvis den skal fjernes." };
  }

  if (attachment.pdf_url) {
    await db.storage.from(BUCKET).remove([attachment.pdf_url]);
  }
  await db.from("contract_attachments").delete().eq("id", attachmentId);

  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}
