"use server"

import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { errorMessage } from "@/lib/error-message"
import { requireMemberContext } from "@/lib/org"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

const BUCKET = "kontrakter"
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "jpg", "jpeg", "png"])

async function memberCaseContext(caseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Ikke logget ind")
  const db = createServiceClient()
  const context = await requireMemberContext(db, user.id)
  if (!context.rightsHolderId) throw new Error("Ingen rettighedshaverprofil i den aktive organisation")
  const { data: entitlementCase, error } = await db.from("rights_entitlement_cases").select(`
    *, works(title), episodes(title),
    withheld_beneficiary_positions(withheld_amount,remaining_amount,currency,rights_work_allocations(claim_deadline)),
    rights_entitlement_evidence(id,attachment_type,original_filename,uploaded_at,review_status),
    member_message_threads(id,subject,member_messages(id,author_role,body,created_at))
  `).eq("id", caseId).eq("org_id", context.orgId).eq("rights_holder_id", context.rightsHolderId).single()
  if (error || !entitlementCase) throw new Error("Rettighedssagen findes ikke")
  return { db, user, context, entitlementCase }
}

export async function getMemberEntitlementCase(caseId: string) {
  try {
    const { entitlementCase } = await memberCaseContext(caseId)
    return { success: true, entitlementCase }
  } catch (error) {
    return { success: false, error: errorMessage(error), entitlementCase: null }
  }
}

export async function uploadEntitlementEvidence(formData: FormData) {
  let uploadedPath: string | null = null
  try {
    const caseId = String(formData.get("caseId") ?? "")
    const attachmentType = String(formData.get("attachmentType") ?? "other")
    const message = String(formData.get("message") ?? "").trim().slice(0, 10_000)
    const file = formData.get("file")
    if (!(file instanceof File) || !file.size) throw new Error("Vælg en dokumentationsfil")
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Filen er for stor. Maksimum er 25 MB.")
    const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Filformatet understøttes ikke")

    const { db, user, context, entitlementCase } = await memberCaseContext(caseId)
    if (["confirmed", "rejected", "administratively_closed"].includes(entitlementCase.status)) {
      throw new Error("Den afsluttede sag modtager ikke ny dokumentation")
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    uploadedPath = `${context.orgId}/rights-entitlement/${caseId}/${randomUUID()}-${safeName}`
    const { error: uploadError } = await db.storage.from(BUCKET).upload(uploadedPath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    })
    if (uploadError) throw new Error("Dokumentationen kunne ikke uploades")

    const { error: evidenceError } = await db.from("rights_entitlement_evidence").insert({
      org_id: context.orgId,
      case_id: caseId,
      contract_id: entitlementCase.contract_id,
      attachment_type: attachmentType,
      storage_path: uploadedPath,
      original_filename: file.name.slice(0, 255),
      uploaded_by: user.id,
      evidence_snapshot: { sha256, source: "member_upload", uploaded_at: new Date().toISOString() },
      review_status: "pending",
    })
    if (evidenceError) throw evidenceError

    const now = new Date().toISOString()
    const { error: caseError } = await db.from("rights_entitlement_cases").update({
      status: "submitted", updated_at: now, version_number: entitlementCase.version_number + 1,
    }).eq("id", caseId).eq("org_id", context.orgId).eq("version_number", entitlementCase.version_number).select("id").single()
    if (caseError) throw caseError

    let thread = Array.isArray(entitlementCase.member_message_threads)
      ? entitlementCase.member_message_threads[0] : entitlementCase.member_message_threads
    if (!thread) {
      const { data, error } = await db.from("member_message_threads").insert({
        org_id: context.orgId,
        rights_holder_id: context.rightsHolderId,
        subject: `Rettighedsforbehold: ${entitlementCase.works?.title ?? "værk"}`,
        context_type: "rights_entitlement_case",
        rights_entitlement_case_id: caseId,
        created_by: user.id,
      }).select("id").single()
      if (error) throw error
      thread = data
      await db.from("member_message_participants").insert({ thread_id: thread.id, user_id: user.id, last_read_at: now })
    }
    if (message) {
      const { error } = await db.from("member_messages").insert({
        thread_id: thread.id, author_user_id: user.id, author_role: "member", body: message,
      })
      if (error) throw error
      await db.from("member_message_threads").update({ updated_at: now }).eq("id", thread.id)
    }
    await db.from("rights_admin_tasks").insert({
      org_id: context.orgId, task_type: "review_entitlement_evidence",
      subject_type: "rights_entitlement_case", subject_id: caseId,
      priority: "normal", description: "Ny dokumentation er indsendt af rettighedshaveren.",
    })

    revalidatePath(`/portal/okonomi/rettighedssager/${caseId}`)
    revalidatePath("/portal/okonomi")
    revalidatePath("/admin/rettighedsmidler")
    return { success: true }
  } catch (error) {
    if (uploadedPath) {
      try { await createServiceClient().storage.from(BUCKET).remove([uploadedPath]) } catch { /* best effort */ }
    }
    console.error("[rights-entitlement] upload fejlede:", error)
    return { success: false, error: errorMessage(error, "Dokumentationen kunne ikke indsendes") }
  }
}

export async function sendEntitlementCaseMessage(caseId: string, bodyValue: string) {
  try {
    const body = bodyValue.trim().slice(0, 10_000)
    if (!body) throw new Error("Skriv en besked")
    const { db, user, context, entitlementCase } = await memberCaseContext(caseId)
    let thread = Array.isArray(entitlementCase.member_message_threads)
      ? entitlementCase.member_message_threads[0] : entitlementCase.member_message_threads
    if (!thread) {
      const { data, error } = await db.from("member_message_threads").insert({
        org_id: context.orgId, rights_holder_id: context.rightsHolderId,
        subject: `Rettighedsforbehold: ${entitlementCase.works?.title ?? "værk"}`,
        context_type: "rights_entitlement_case", rights_entitlement_case_id: caseId, created_by: user.id,
      }).select("id").single()
      if (error) throw error
      thread = data
    }
    const { error } = await db.from("member_messages").insert({
      thread_id: thread.id, author_user_id: user.id, author_role: "member", body,
    })
    if (error) throw error
    await db.from("member_message_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id)
    revalidatePath(`/portal/okonomi/rettighedssager/${caseId}`)
    revalidatePath("/admin/beskeder")
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Beskeden kunne ikke sendes") }
  }
}
