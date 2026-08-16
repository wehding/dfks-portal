"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { tjekNavn } from "@/lib/rettighedshaver-tjek";
import type { ProductionCompanySelection } from "@/lib/production-companies";
import { syncContractProducerRelations } from "@/lib/server/production-company-relations";
import { mergeContractWorkData, type LinkedContractWorkData } from "@/lib/contract-work-data";
import { isUuid } from "@/lib/uuid";
import { resolveDefaultRole } from "@/lib/branding";
import { parseLocalEpisodeCode } from "@/lib/series-episodes";
import { sendMemberNotification } from "@/lib/member-notifications";
import { effectiveCopydanStatus, normalizeTriState, weeklySalaryWithPersonalSupplement } from "@/lib/contract-list-status";
import { resolveSeriesScopeTarget, upsertMemberSeriesEpisodeScope } from "@/lib/server/member-series-episode-scopes";

import { requireOrgId } from "@/lib/org";
const BUCKET = "kontrakter"; // samme bucket som admin-validering
const MAX_CONTRACT_UPLOAD_BYTES = 25 * 1024 * 1024;

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

async function contractValidationBlocker(
  db: ReturnType<typeof createServiceClient>,
  contract: { id: string; work_id: string | null; rights_holder_id: string | null },
) {
  if (!contract.work_id) return "Kontrakten skal have et tilknyttet værk.";
  if (!contract.rights_holder_id) return "Kontrakten skal have en tilknyttet rettighedshaver.";
  const { data: work } = await db.from("works").select("id,type,parent_work_id,season_number").eq("id", contract.work_id).maybeSingle();
  if (!String(work?.type ?? "").includes("serie")) return null;
  const { data: contractScope } = await db.from("contracts")
    .select("org_id,season_number,episode_scope_id")
    .eq("id", contract.id).maybeSingle();
  const seriesWorkId = work?.parent_work_id ?? work?.id;
  const seasonNumber = contractScope?.season_number ?? work?.season_number ?? 1;
  let scopeQuery = db.from("member_series_episode_scopes").select("id,status").eq("status", "confirmed");
  if (contractScope?.episode_scope_id) scopeQuery = scopeQuery.eq("id", contractScope.episode_scope_id);
  else scopeQuery = scopeQuery
    .eq("org_id", contractScope?.org_id)
    .eq("rights_holder_id", contract.rights_holder_id)
    .eq("series_work_id", seriesWorkId)
    .eq("season_number", seasonNumber);
  const { data: sharedScope } = await scopeQuery.maybeSingle();
  if (sharedScope) return null;
  const { data: confirmation } = await db.from("contract_episode_confirmations")
    .select("id").eq("contract_id", contract.id).is("invalidated_at", null).maybeSingle();
  return confirmation ? null : "Rettighedshaveren skal bekræfte sæson og afsnit, før seriekontrakten kan valideres.";
}

type SeriesEpisodeWork = { id: string; title: string | null; season_number: number | null; episode_number: number | null; parent_work_id: string | null };

// Henter alle afsnit-værker for en serie (selve serien + dens børneværker) i en org.
// parentId valideres som UUID før strenginterpolation i .or(...) (defense-in-depth mod filter-injection).
async function fetchSeriesEpisodeWorks(
  db: ReturnType<typeof createServiceClient>,
  orgId: string,
  parentId: string,
): Promise<{ episodeWorks: SeriesEpisodeWork[]; error: string | null }> {
  if (!isUuid(parentId)) return { episodeWorks: [], error: null };
  const { data: relatedWorks, error } = await db
    .from("works")
    .select("id, title, season_number, episode_number, parent_work_id")
    .eq("org_id", orgId)
    .or(`id.eq.${parentId},parent_work_id.eq.${parentId}`);
  if (error) return { episodeWorks: [], error: error.message };
  const episodeWorks = ((relatedWorks ?? []) as SeriesEpisodeWork[]).filter(item => item.episode_number != null || parseLocalEpisodeCode(item.title));
  return { episodeWorks, error: null };
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

  const orgId = await requireOrgId(db, user.id);

  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "Ingen fil modtaget" };
  if (file.size > MAX_CONTRACT_UPLOAD_BYTES) {
    return { success: false, error: "Filen er for stor. Maksimum er 25 MB." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "doc", "docx", "txt"].includes(ext)) {
    return { success: false, error: "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT" };
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
  workTitle?: string;
  workId?: string;
  productionType: string;
  roles: string[];
  duration?: number;
  premiereDate?: string;
  season?: number;
  episodes?: { number: number; role: string }[];
  coversWholeSeason?: boolean;
  episodeSelectionConfirmed?: boolean;
  deferAiJob?: boolean;
  producerSelections?: ProductionCompanySelection[];
}) {
  const db = createServiceClient();
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const orgId = await requireOrgId(db, user.id);
  if (!params.filePath.startsWith(`${orgId}/`)) {
    return { success: false, error: "Filstien tilhører ikke din organisation" };
  }

  const { data: saved, error: dbErr } = await db
    .from("contracts")
    .insert({
      org_id: orgId,
      rights_holder_id: rh.id,
      type: "a-løn",
      status: "kladde",
      pdf_url: params.filePath,
      working_title: params.workTitle || null,
      work_id: params.workId ?? null,
      season_number: params.season ?? null,
      episode_numbers: params.season && params.episodeSelectionConfirmed
        ? params.coversWholeSeason
          ? []
          : params.episodes?.map(episode => episode.number).filter(number => Number.isInteger(number) && number > 0) ?? []
        : null,
    })
    .select()
    .single();

  if (dbErr || !saved) return { success: false, error: dbErr?.message ?? "Kunne ikke gemme kontrakten" };

  if (params.workId && params.season) {
    const target = await resolveSeriesScopeTarget(db, params.workId, params.season);
    if (target) {
      const episodes = params.episodes?.map(episode => episode.number) ?? [];
      const confirmed = Boolean(params.episodeSelectionConfirmed && (params.coversWholeSeason || episodes.length > 0));
      const scopeResult = await upsertMemberSeriesEpisodeScope(db, {
        orgId,
        rightsHolderId: rh.id,
        seriesWorkId: target.seriesWorkId,
        seasonNumber: target.seasonNumber,
        status: confirmed ? "confirmed" : "pending",
        episodeNumbers: episodes,
        coversWholeSeason: confirmed && params.coversWholeSeason,
        source: "contract_upload",
      });
      if (!scopeResult.success) {
        await db.from("contracts").delete().eq("id", saved.id);
        await db.storage.from(BUCKET).remove([params.filePath]);
        return { success: false, error: scopeResult.error };
      }
      await db.from("contracts").update({
        episode_scope_id: scopeResult.scope.id,
        season_number: scopeResult.scope.season_number,
        episode_numbers: scopeResult.scope.status === "confirmed"
          ? scopeResult.scope.covers_whole_season ? [] : scopeResult.scope.episode_numbers
          : null,
      }).eq("id", saved.id);
    }
  }

  const { error: validationError } = await db.from("contract_validations").insert({
    contract_id: saved.id,
    org_id: orgId,
    notes: JSON.stringify({
      memberName: rh.full_name ?? params.memberName,
      workTitle: params.workTitle,
      workId: params.workId,
      productionType: params.productionType || undefined,
      creditedRoles: params.roles,
      duration: params.duration,
      premiereDate: params.premiereDate,
      season: params.season,
      episodes: params.episodes,
      submittedByMember: true,
    }),
  });

  if (validationError) {
    await db.from("contracts").delete().eq("id", saved.id);
    await db.storage.from(BUCKET).remove([params.filePath]);
    return { success: false, error: validationError.message };
  }

  if (params.producerSelections?.length) {
    try {
      await syncContractProducerRelations(db, saved.id, params.producerSelections, "member_upload");
    } catch (producerError) {
      await db.from("contracts").delete().eq("id", saved.id).eq("org_id", orgId);
      await db.storage.from(BUCKET).remove([params.filePath]);
      return {
        success: false,
        error: producerError instanceof Error ? producerError.message : "Producenten kunne ikke tilknyttes kontrakten",
      };
    }
  }

  if (!params.deferAiJob) {
    const isPdf = params.filePath.toLowerCase().endsWith(".pdf");
    const result = isPdf
      ? await db.from("contract_document_jobs").insert({
        contract_id: saved.id,
        org_id: orgId,
        created_by: user.id,
        original_storage_path: params.filePath,
        output_storage_path: `${orgId}/processed/${saved.id}/normalised.pdf`,
        status: "queued",
        priority: 100,
      })
      : await db.from("contract_ai_jobs").insert({
        contract_id: saved.id,
        org_id: orgId,
        status: "queued",
        priority: 0,
      });

    if (result.error) {
      console.error("Kunne ikke oprette behandlingsjob for uploadet kontrakt:", result.error);
    } else if (!isPdf) {
      triggerContractAiJobProcessing(orgId);
    }
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, contract: saved };
}

export async function queueUploadedContractAiJob(contractId: string) {
  const db = createServiceClient();
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };
  const orgId = await requireOrgId(db, user.id);
  const { data: contract } = await db
    .from("contracts")
    .select("id,pdf_url")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();
  if (!contract) return { success: false, error: "Kontrakten blev ikke fundet" };

  if (contract.pdf_url?.toLowerCase().endsWith(".pdf")) {
    const { data: existingDocumentJob } = await db.from("contract_document_jobs")
      .select("id").eq("contract_id", contractId).in("status", ["queued", "processing", "failed"]).lt("attempts", 5).limit(1).maybeSingle();
    if (existingDocumentJob) return { success: true, alreadyQueued: true };
    const { error } = await db.from("contract_document_jobs").insert({
      contract_id: contractId,
      org_id: orgId,
      created_by: user.id,
      original_storage_path: contract.pdf_url,
      output_storage_path: `${orgId}/processed/${contractId}/normalised.pdf`,
      status: "queued",
      priority: 100,
    });
    if (error) return { success: false, error: error.message };
    await db.from("contracts").update({ document_processing_status: "pending", document_processing_error_code: null }).eq("id", contractId).eq("org_id", orgId);
    return { success: true, alreadyQueued: false };
  }

  const { data: existing } = await db
    .from("contract_ai_jobs")
    .select("id")
    .eq("contract_id", contractId)
    .in("status", ["queued", "processing", "retry_wait", "blocked", "error"])
    .limit(1)
    .maybeSingle();
  if (existing) return { success: true, alreadyQueued: true };

  const { error } = await db.from("contract_ai_jobs").insert({
    contract_id: contractId,
    org_id: orgId,
    status: "queued",
    priority: 0,
  });
  if (error) return { success: false, error: error.message };
  triggerContractAiJobProcessing(orgId);
  return { success: true, alreadyQueued: false };
}

// Udløs jobkøen med det samme, så auto-kobling af kontrakt→værk ikke venter på
// det daglige cron-job. Kører direkte i baggrunden via after().
function triggerContractAiJobProcessing(orgId: string) {
  after(async () => {
    try {
      const { processPendingContractJobs } = await import("@/lib/server/contract-import-processor");
      await processPendingContractJobs(orgId);
    } catch (e) {
      console.error("[contract-job] Baggrundsaflæsning fejlede:", e);
    }
  });
}

export async function fetchMemberContractsList() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", contracts: [] };

  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet", contracts: [] };

  const { data, error } = await db
    .from("contracts")
    .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, work_id, working_title, created_at, works(id, title, year, type), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at)")
    .eq("rights_holder_id", rh.id)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message, contracts: [] };
  return { success: true, contracts: data ?? [] };
}

export async function linkContractToWork(
  contractId: string,
  workId: string | null,
  scope?: { seasonNumber?: number | null; episodeNumbers?: number[] | null; coversWholeSeason?: boolean; episodeSelectionConfirmed?: boolean }
) {
  const supabase = await createClient();
  const db = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  // Kontrakten skal tilhøre medlemmet
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };

  // Værket skal findes og tilhøre samme org som kontrakten
  if (workId) {
    const { data: work } = await db.from("works").select("id, org_id").eq("id", workId).maybeSingle();
    if (!work || work.org_id !== contract.org_id) {
      return { success: false, error: "Værket findes ikke i din organisation" };
    }
  }

  let episodeScopeId: string | null = null;
  let resolvedSeasonNumber: number | null = null;
  let resolvedEpisodeNumbers: number[] | null = null;
  if (workId) {
    const target = await resolveSeriesScopeTarget(db, workId, scope?.seasonNumber);
    if (target) {
      const episodes = scope?.episodeNumbers ?? [];
      const confirmed = Boolean(scope?.episodeSelectionConfirmed && (scope.coversWholeSeason || episodes.length > 0));
      const scopeResult = await upsertMemberSeriesEpisodeScope(db, {
        orgId: contract.org_id,
        rightsHolderId: rh.id,
        seriesWorkId: target.seriesWorkId,
        seasonNumber: target.seasonNumber,
        status: confirmed ? "confirmed" : "pending",
        episodeNumbers: episodes,
        coversWholeSeason: confirmed && scope?.coversWholeSeason,
        source: "contract_link",
      });
      if (!scopeResult.success) return scopeResult;
      episodeScopeId = scopeResult.scope.id;
      resolvedSeasonNumber = scopeResult.scope.season_number;
      resolvedEpisodeNumbers = scopeResult.scope.status === "confirmed"
        ? scopeResult.scope.covers_whole_season ? [] : scopeResult.scope.episode_numbers
        : null;
    }
  }
  const { error } = await db
    .from("contracts")
    .update({
      work_id: workId,
      episode_scope_id: episodeScopeId,
      season_number: workId ? resolvedSeasonNumber : null,
      episode_numbers: workId ? resolvedEpisodeNumbers : null,
    })
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function fetchMemberContractDetail(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const { data, error } = await db
    .from("contracts")
    .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, work_id, working_title, season_number, episode_numbers, created_at, works(id, title, year, type), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at), contract_attachments(id, type, title, pdf_url, created_at, ai_status, ai_result), contract_comments(id, author_role, message, created_at, member_read_at, admin_read_at)")
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Kontrakten blev ikke fundet." };
  return { success: true, contract: data };
}

export async function getContractSignedUrl(pdfUrl: string) {
  const user = await currentUser();
  if (!user) return { url: null, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { url: null, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, pdf_url")
    .eq("pdf_url", pdfUrl)
    .maybeSingle();

  if (contract) {
    if (contract.rights_holder_id !== rh.id) {
      const isAdmin = await assertAdminForOrg(db, user.id, contract.org_id);
      if (!isAdmin) return { url: null, error: "Ikke autoriseret" };
    }
  } else {
    const { data: attachment } = await db
      .from("contract_attachments")
      .select("pdf_url, contracts(id, org_id, rights_holder_id)")
      .eq("pdf_url", pdfUrl)
      .maybeSingle();
    const relation = (attachment as { contracts?: { org_id: string; rights_holder_id: string | null } | { org_id: string; rights_holder_id: string | null }[] | null } | null)?.contracts;
    const owner = Array.isArray(relation) ? relation[0] : relation;
    if (!owner) return { url: null, error: "Fil ikke fundet" };
    if (owner.rights_holder_id !== rh.id) {
      const isAdmin = await assertAdminForOrg(db, user.id, owner.org_id);
      if (!isAdmin) return { url: null, error: "Ikke autoriseret" };
    }
  }

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

  // Ryd op i storage: både selve kontrakten og evt. vedhæftede allonger/bilag,
  // så filer ikke bliver forældreløse når DB-rækkerne cascade-slettes.
  const { data: attachments } = await db
    .from("contract_attachments")
    .select("pdf_url")
    .eq("contract_id", contractId);
  const storagePaths = [
    contract.pdf_url,
    ...((attachments ?? []).map(a => a.pdf_url)),
  ].filter((p): p is string => Boolean(p));
  if (storagePaths.length > 0) {
    await db.storage.from(BUCKET).remove(storagePaths);
  }

  await db.from("contracts").delete().eq("id", contractId);

  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function getContractValidation(contractId: string, includeEpisodes = true) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select(`
      id, org_id, type, overenskomst, contract_date, start_date, end_date,
      working_title, rights_holder_id,
      employers(name), rettighedshavere(full_name),
      works(
        id, title, type, year, duration_minutes, season_count, season_number,
        episode_count, episode_number, parent_work_id, genre, director,
        production_companies, production_countries, description,
        dfi_id, tmdb_id, imdb_id
      )
    `)
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  const { data } = await db
    .from("contract_validations")
    .select("extracted_data")
    .eq("contract_id", contractId)
    .maybeSingle();

  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  const employer = Array.isArray(contract.employers) ? contract.employers[0] : contract.employers;
  const rightsHolder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
  const parsedEpisode = parseLocalEpisodeCode(relatedWork?.title);
  const work: LinkedContractWorkData | null = relatedWork ? {
    ...relatedWork,
    season_number: relatedWork.season_number ?? parsedEpisode?.seasonNumber ?? null,
    episode_number: relatedWork.episode_number ?? parsedEpisode?.episodeNumber ?? null,
  } : null;
  const extractedData = mergeContractWorkData({
    extractedData: (data?.extracted_data ?? null) as Record<string, unknown> | null,
    contract,
    work,
    employerName: employer?.name ?? null,
    rightsHolderName: rightsHolder?.full_name ?? null,
  });

  const linkedEpisodes: Array<{ id: string; title: string; seasonNumber: number; episodeNumber: number; role: string | null }> = [];
  const episodeOptions: Array<{ id: string; title: string; seasonNumber: number; episodeNumber: number }> = [];
  if (includeEpisodes && relatedWork && contract.rights_holder_id) {
    const parentId = relatedWork.parent_work_id ?? relatedWork.id;
    const { episodeWorks } = await fetchSeriesEpisodeWorks(db, contract.org_id, parentId);
    const episodeIds = episodeWorks.map(item => item.id);
    const { data: assignments } = episodeIds.length > 0
      ? await db
        .from("work_assignments")
        .select("work_id, role")
        .eq("org_id", contract.org_id)
        .eq("rights_holder_id", contract.rights_holder_id)
        .in("work_id", episodeIds)
      : { data: [] as Array<{ work_id: string; role: string | null }> };
    const roleByWork = new Map((assignments ?? []).map(item => [item.work_id, item.role]));

    for (const episode of episodeWorks) {
      const parsed = parseLocalEpisodeCode(episode.title);
      const seasonNumber = episode.season_number ?? parsed?.seasonNumber;
      const episodeNumber = episode.episode_number ?? parsed?.episodeNumber;
      if (seasonNumber == null || episodeNumber == null) continue;
      episodeOptions.push({ id: episode.id, title: episode.title ?? "", seasonNumber, episodeNumber });
      const isDirectContractEpisode = episode.id === relatedWork.id;
      if (!isDirectContractEpisode && !roleByWork.has(episode.id)) continue;
      linkedEpisodes.push({
        id: episode.id,
        title: episode.title ?? "",
        seasonNumber,
        episodeNumber,
        role: roleByWork.get(episode.id) ?? null,
      });
    }
    linkedEpisodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    episodeOptions.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  }

  const isSeriesWork = relatedWork?.type === "tv-serie" || relatedWork?.type === "dokumentar-serie" || Boolean(relatedWork?.parent_work_id);
  // hasSavedValidation afspejler om der faktisk findes gemte valideringsdata FØR merge med værkets
  // fallback-felter — så UI kan skelne "endnu ingen validering" fra "felter fyldt fra det linkede værk".
  const hasSavedValidation = Boolean(data?.extracted_data && Object.keys(data.extracted_data as Record<string, unknown>).length > 0);
  return {
    success: true,
    extractedData,
    linkedEpisodes,
    episodeOptions,
    isSeriesWork,
    hasSavedValidation,
    workIdentifiers: {
      dfiId: work?.dfi_id ?? null,
      tmdbId: work?.tmdb_id ?? null,
      imdbId: work?.imdb_id ?? null,
    },
  };
}

export type ContractValidationSectionKey = "rights" | "dates" | "salary" | "series" | "signature" | "ids" | "work";

const CONTRACT_VALIDATION_SECTION_FIELDS: Record<ContractValidationSectionKey, readonly string[]> = {
  rights: [
    "copydan", "svod", "agreementReferenceStatus", "collectiveAgreement",
    "collectiveAgreementByReference", "hasOverenskomstIncorporation", "rightsNotApplicable",
    "royalty", "royaltyPercent", "aiDataMiningClause", "futureRightsReservation",
    "rightsOverview", "distribution", "hasCreditClause", "_sources", "_lockedFields",
  ],
  dates: ["contractDate", "startDate", "endDate", "_sources", "_lockedFields"],
  salary: [
    "salary", "salaryUnit", "salarySourceType", "salaryConfidence", "salaryNote",
    "needsManualSalaryReview", "workingDays", "workingWeeks", "loentillaeg",
    "contractType", "isFreelanceContract", "agreementEmploymentForm",
    "pensionPercent", "pensionSupplement", "pensionStatus", "pensionEmployerPercent",
    "pensionEmployeePercent", "pensionTotalPercent", "pensionBasis", "pensionBasisAmount",
    "pensionAgreementCode", "pensionAgreementTitle", "pensionAgreementSection",
    "pensionAgreementSourceUrl", "pensionSourceType", "pensionEvidence", "pensionConfidence", "pensionTag",
    "personalSupplement", "postProductionSupplement", "otherSupplements",
    "holidayPayRate", "betaRate", "_sources", "_lockedFields",
  ],
  series: ["seasonNumber", "episodeNumber", "episodeCount", "seasonCount", "_sources", "_lockedFields"],
  signature: ["signatureStatus", "signatureMethod", "signatureDate", "signatureEvidence", "signaturePage", "_sources", "_lockedFields"],
  ids: ["dfiId", "tmdbId", "imdbId"],
  work: [
    "workTitle", "director", "duration", "premiereYear", "genre", "description",
    "productionCountries", "creditedFunction", "creditedRoles", "productionType",
    "_sources", "_lockedFields",
  ],
};

function pickValidationFields(data: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => key in data).map(key => [key, data[key]]));
}

function valueText(value: unknown, fallback = "Ukendt") {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
  return String(value);
}

export async function getContractValidationSummary(contractId: string) {
  const result = await getContractValidation(contractId, false);
  if (!result.success || !result.extractedData) return result;
  const data = result.extractedData;
  const weeklySalary = weeklySalaryWithPersonalSupplement(data);
  const copydan = effectiveCopydanStatus({
    overenskomst: valueText(data.overenskomst, ""),
    validation_data: data,
  });
  return {
    success: true,
    found: result.hasSavedValidation,
    isSeriesWork: result.isSeriesWork,
    summaries: {
      rights: { copydan, streaming: normalizeTriState(data.svod ?? (data.rightsOverview as Record<string, unknown> | undefined)?.streamingforbehold), signature: normalizeTriState(data.signatureStatus) },
      dates: valueText(data.contractDate, "Ingen kontraktdato"),
      salary: [
        weeklySalary ? `${Math.round(weeklySalary).toLocaleString("da-DK")} kr./uge inkl. tillæg` : "Løn ikke fundet",
        valueText(data.pensionTag, ""),
      ].filter(Boolean).join(" · "),
      series: `Sæson ${valueText(data.seasonNumber, "—")} · afsnit ${valueText(data.episodeNumber ?? data.episodeCount, "—")}`,
      signature: normalizeTriState(data.signatureStatus),
      ids: [result.workIdentifiers?.dfiId && `DFI ${result.workIdentifiers.dfiId}`, result.workIdentifiers?.tmdbId && `TMDB ${result.workIdentifiers.tmdbId}`, result.workIdentifiers?.imdbId && `IMDb ${result.workIdentifiers.imdbId}`].filter(Boolean).join(" · ") || "Ingen ID'er",
      work: valueText(data.workTitle, "Ingen værkstitel aflæst"),
    },
  };
}

export async function getContractValidationSection(params: { contractId: string; section: ContractValidationSectionKey }) {
  if (!CONTRACT_VALIDATION_SECTION_FIELDS[params.section]) return { success: false, error: "Ukendt sektion" };
  const result = await getContractValidation(params.contractId, params.section === "series");
  if (!result.success || !result.extractedData) return result;
  const sectionData = pickValidationFields(result.extractedData, CONTRACT_VALIDATION_SECTION_FIELDS[params.section]);
  if (params.section === "ids") {
    sectionData.dfiId = result.workIdentifiers?.dfiId ?? null;
    sectionData.tmdbId = result.workIdentifiers?.tmdbId ?? null;
    sectionData.imdbId = result.workIdentifiers?.imdbId ?? null;
  }
  if (params.section === "rights" && sectionData.agreementReferenceStatus == null) {
    sectionData.agreementReferenceStatus = [
      sectionData.collectiveAgreement,
      sectionData.collectiveAgreementByReference,
      sectionData.hasOverenskomstIncorporation,
    ].some(value => normalizeTriState(value) === "yes") ? "yes" : "unknown";
  }
  return {
    success: true,
    data: sectionData,
    linkedEpisodes: params.section === "series" ? result.linkedEpisodes : undefined,
    episodeOptions: params.section === "series" ? result.episodeOptions : undefined,
    isSeriesWork: result.isSeriesWork,
  };
}

export async function saveContractValidationSection(params: {
  contractId: string;
  section: ContractValidationSectionKey;
  data: Record<string, unknown>;
  lockedFields?: string[];
}) {
  const allowed = CONTRACT_VALIDATION_SECTION_FIELDS[params.section];
  if (!allowed) return { success: false, error: "Ukendt sektion" };
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", params.contractId).single();
  if (!contract || !(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  const { data: existing } = await db.from("contract_validations").select("extracted_data").eq("contract_id", params.contractId).maybeSingle();
  const previous = (existing?.extracted_data ?? {}) as Record<string, unknown>;
  const patch = pickValidationFields(params.data, allowed.filter(key => !key.startsWith("_")));
  if (patch.rightsOverview && typeof patch.rightsOverview === "object") {
    patch.rightsOverview = {
      ...((previous.rightsOverview as Record<string, unknown> | undefined) ?? {}),
      ...(patch.rightsOverview as Record<string, unknown>),
    };
  }
  const sectionFieldSet = new Set(allowed.filter(key => !key.startsWith("_")));
  const previousLocks = Array.isArray(previous._lockedFields) ? previous._lockedFields.filter((key): key is string => typeof key === "string") : [];
  patch._lockedFields = [
    ...previousLocks.filter(key => !sectionFieldSet.has(key)),
    ...(params.lockedFields ?? []).filter(key => sectionFieldSet.has(key)),
  ];
  return saveContractValidation({ contractId: params.contractId, extractedData: patch });
}

export async function updateAdminContractEpisodeAssignments(params: {
  contractId: string;
  selectedWorkIds: string[];
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, works(id, parent_work_id, type)")
    .eq("id", params.contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  if (!contract.rights_holder_id) return { success: false, error: "Kontrakten mangler et medlem" };

  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  if (!relatedWork) return { success: false, error: "Kontrakten mangler et værk" };
  const parentId = relatedWork.parent_work_id ?? relatedWork.id;
  const { episodeWorks, error: worksError } = await fetchSeriesEpisodeWorks(db, contract.org_id, parentId);
  if (worksError) return { success: false, error: worksError };
  const allowedIds = new Set(episodeWorks.map(item => item.id));
  const selectedIds = [...new Set(params.selectedWorkIds.filter(id => allowedIds.has(id)))];
  if (selectedIds.length !== new Set(params.selectedWorkIds).size) {
    return { success: false, error: "Et eller flere valgte afsnit tilhører ikke kontraktens serie" };
  }

  const episodeIds = [...allowedIds];
  const { data: existing, error: existingError } = episodeIds.length > 0
    ? await db
      .from("work_assignments")
      .select("id, work_id, role")
      .eq("org_id", contract.org_id)
      .eq("rights_holder_id", contract.rights_holder_id)
      .in("work_id", episodeIds)
    : { data: [], error: null };
  if (existingError) return { success: false, error: existingError.message };

  const selectedSet = new Set(selectedIds);
  const existingWorkIds = new Set((existing ?? []).map(item => item.work_id));
  const removeIds = (existing ?? []).filter(item => !selectedSet.has(item.work_id)).map(item => item.id);
  // Default-rolle udledes fra organisationens terminologi (fx "Klipper" for DFKS), ikke hardcodet.
  const { data: orgForRole } = await db.from("organisations").select("terminology").eq("id", contract.org_id).maybeSingle();
  const defaultRole = resolveDefaultRole(orgForRole ?? null);
  const role = (existing ?? []).find(item => item.role)?.role ?? defaultRole;
  const additions = selectedIds.filter(id => !existingWorkIds.has(id)).map(workId => ({
    org_id: contract.org_id,
    work_id: workId,
    rights_holder_id: contract.rights_holder_id,
    role,
  }));
  if (additions.length > 0) {
    const { error } = await db.from("work_assignments").upsert(additions, { onConflict: "work_id,rights_holder_id,role" });
    if (error) return { success: false, error: error.message };
  }
  if (removeIds.length > 0) {
    const { error } = await db.from("work_assignments").delete().in("id", removeIds);
    if (error) return { success: false, error: error.message };
  }

  const { error: contractError } = await db
    .from("contracts")
    .update({ work_id: selectedIds.length === 1 ? selectedIds[0] : parentId })
    .eq("id", contract.id)
    .eq("org_id", contract.org_id);
  if (contractError) return { success: false, error: contractError.message };

  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/portal/mine-vaerker");
  return { success: true, selectedWorkIds: selectedIds };
}

export async function saveContractValidation(params: { contractId: string; extractedData: Record<string, unknown> }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", params.contractId).single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const ed = params.extractedData as Record<string, unknown>;

  // Editoren sender kun de felter den kender (GROUPS). Flet oven på den
  // eksisterende extracted_data, så øvrige nøgler (fx AI-kildecitater _sources,
  // hasTerminationClause, terminationDaysEditor/Producer, hasIndemnification)
  // ikke slettes ved hver gem.
  const { data: existing } = await db
    .from("contract_validations")
    .select("extracted_data")
    .eq("contract_id", params.contractId)
    .maybeSingle();
  const prevEd = (existing?.extracted_data ?? {}) as Record<string, unknown>;
  const mergedEd = { ...prevEd, ...ed };

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { error } = await writeDb.from("contract_validations").upsert(
    {
      contract_id: params.contractId,
      org_id: contract.org_id,
      holiday_pay_rate: (mergedEd.holidayPayRate as number) ?? null,
      beta_rate: (mergedEd.betaRate as number) ?? null,
      has_overenskomst_incorporation: normalizeTriState(mergedEd.agreementReferenceStatus) === "yes"
        || !!mergedEd.collectiveAgreement
        || !!mergedEd.collectiveAgreementByReference
        || !!mergedEd.hasOverenskomstIncorporation,
      has_credit_clause: !!(mergedEd.creditedRoles || mergedEd.creditedFunction || mergedEd.hasCreditClause),
      notes: (mergedEd.specialNotes as string) ?? null,
      extracted_data: mergedEd,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    },
    { onConflict: "contract_id" }
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/kontrakter");
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

  const actorOrgId = await requireOrgId(db, user.id);
  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });

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
  if (pdfs.length > 0) await writeDb.storage.from(BUCKET).remove(pdfs);

  // Slet i batches så store cascade-sletninger ikke rammer statement-timeout
  const foundIds = found.map(row => row.id);
  for (let i = 0; i < foundIds.length; i += 50) {
    const chunk = foundIds.slice(i, i + 50);
    const { error } = await writeDb.from("contracts").delete().in("id", chunk);
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

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    actorRole: "member",
    source: "portal",
    correlationId: crypto.randomUUID(),
  } });
  const { data: comment, error } = await writeDb
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
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { data: comment, error } = await writeDb
    .from("contract_comments")
    .insert({
      org_id: contract.org_id,
      contract_id: contract.id,
      author_user_id: user.id,
      author_role: "admin",
      message: text,
      admin_read_at: new Date().toISOString(),
      member_read_at: null,
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();

  if (error || !comment) return { success: false, error: error?.message ?? "Kunne ikke gemme svaret" };
  if (contract.rights_holder_id) {
    try {
      await sendMemberNotification({
        eventKey: `contract-comment:${comment.id}`,
        eventType: "contract_admin_reply",
        orgId: contract.org_id,
        rightsHolderId: contract.rights_holder_id,
        category: "transactional",
        subject: "DFKS har svaret på din kontrakt",
        bodyText: "Der er kommet et nyt svar til din kontrakt i portalen.",
        path: `/portal/mine-kontrakter?contract=${contract.id}`,
        entityType: "contract",
        entityId: contract.id,
      });
    } catch (notificationError) {
      console.error("[notification] kontraktsvar kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true, comment };
}

export type AdminContractUpdate = {
  type?: string;
  overenskomst?: string | null;
  status?: string;
  contract_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  employer_id?: string | null;
  rights_holder_id?: string | null;
  work_id?: string | null;
  working_title?: string | null;
  season_number?: number | null;
  episode_numbers?: number[] | null;
  producer_selections?: ProductionCompanySelection[];
};

export async function fetchAdminContractEditorData(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };

  const [contractResult, rightsHoldersResult, worksResult, producerResult] = await Promise.all([
    db.from("contracts")
      .select("id,type,overenskomst,status,pdf_url,contract_date,start_date,end_date,employer_id,rights_holder_id,work_id,working_title,season_number,episode_numbers,employers(name),rettighedshavere(full_name),works(title,year,type),contract_comments(*),contract_attachments(*)")
      .eq("id", contractId)
      .eq("org_id", orgId)
      .maybeSingle(),
    db.from("rettighedshavere")
      .select("id,full_name,org_affiliations!inner(org_id)")
      .eq("org_affiliations.org_id", orgId)
      .order("full_name")
      .limit(1000),
    db.from("works")
      .select("id,title,year,type")
      .eq("org_id", orgId)
      .order("title")
      .limit(1000),
    db.from("contract_employers")
      .select("employer_id,legal_entity_id,sort_order,employers(name),employer_legal_entities(legal_name,registration_number)")
      .eq("contract_id", contractId)
      .order("sort_order"),
  ]);

  if (contractResult.error) return { success: false, error: contractResult.error.message };
  if (!contractResult.data) return { success: false, error: "Kontrakten blev ikke fundet" };
  if (rightsHoldersResult.error) return { success: false, error: rightsHoldersResult.error.message };
  if (worksResult.error) return { success: false, error: worksResult.error.message };

  const contract = contractResult.data;
  const employer = Array.isArray(contract.employers) ? contract.employers[0] : contract.employers;
  const producerSelections: ProductionCompanySelection[] = producerResult.error
    ? (contract.employer_id && employer?.name ? [{ employerId: contract.employer_id, canonicalName: employer.name }] : [])
    : (producerResult.data ?? []).map(row => {
        const producer = Array.isArray(row.employers) ? row.employers[0] : row.employers;
        const entity = Array.isArray(row.employer_legal_entities) ? row.employer_legal_entities[0] : row.employer_legal_entities;
        return {
          employerId: row.employer_id,
          legalEntityId: row.legal_entity_id ?? undefined,
          canonicalName: producer?.name ?? "Producent",
          legalName: entity?.legal_name ?? undefined,
          registrationNumber: entity?.registration_number ?? undefined,
        };
      });

  return {
    success: true,
    contract,
    rightsHolders: rightsHoldersResult.data ?? [],
    works: worksResult.data ?? [],
    producerSelections,
  };
}

export async function updateAdminContract(contractId: string, values: AdminContractUpdate) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const { data: existing } = await db.from("contracts").select("id,status,org_id,work_id,rights_holder_id,season_number,episode_numbers").eq("id", contractId).eq("org_id", orgId).maybeSingle();
  if (!existing) return { success: false, error: "Kontrakten blev ikke fundet" };
  const requestedEpisodeScopeChange =
    (values.work_id !== undefined && values.work_id !== existing.work_id) ||
    (values.season_number !== undefined && values.season_number !== existing.season_number) ||
    (values.episode_numbers !== undefined && JSON.stringify(values.episode_numbers ?? null) !== JSON.stringify(existing.episode_numbers ?? null));
  if (values.status === "valideret" && existing.status !== "valideret") {
    const targetWorkId = values.work_id === undefined ? existing.work_id : values.work_id;
    const { data: targetWork } = targetWorkId
      ? await db.from("works").select("type").eq("id", targetWorkId).maybeSingle()
      : { data: null };
    if (requestedEpisodeScopeChange && String(targetWork?.type ?? "").includes("serie")) {
      return { success: false, error: "Gem værks- og afsnitsændringerne først. Rettighedshaveren skal derefter bekræfte afsnittene før validering." };
    }
    const blocker = await contractValidationBlocker(db, {
      id: existing.id,
      work_id: targetWorkId,
      rights_holder_id: values.rights_holder_id === undefined ? existing.rights_holder_id : values.rights_holder_id,
    });
    if (blocker) return { success: false, error: blocker };
  }
  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: orgId,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { producer_selections: producerSelections, status: requestedStatus, ...remainingContractValues } = values;
  const contractValues = requestedStatus === undefined || requestedStatus === "valideret"
    ? remainingContractValues
    : { ...remainingContractValues, status: requestedStatus };
  const { error } = await writeDb.from("contracts").update(contractValues).eq("id", contractId).eq("org_id", orgId);
  if (error) return { success: false, error: error.message };
  if (requestedStatus === "valideret" && existing.status !== "valideret") {
    const { error: validationError } = await writeDb.rpc("validate_contracts_explicitly", {
      p_actor_user_id: user.id,
      p_org_id: orgId,
      p_contract_ids: [contractId],
    });
    if (validationError) return { success: false, error: validationError.message };
  }
  if (requestedEpisodeScopeChange) {
    await writeDb.from("contract_episode_confirmations").update({ invalidated_at: new Date().toISOString() }).eq("contract_id", contractId).is("invalidated_at", null);
  }
  if (producerSelections) {
    try {
      await syncContractProducerRelations(writeDb, contractId, producerSelections, "admin");
    } catch (relationError) {
      return { success: false, error: relationError instanceof Error ? relationError.message : "Producentrelationer kunne ikke gemmes" };
    }
  }
  if (existing.status !== "valideret" && values.status === "valideret" && values.rights_holder_id) {
    try {
      await sendMemberNotification({ eventKey: `contract-validated:${contractId}`, eventType: "contract_validated", orgId, rightsHolderId: values.rights_holder_id, category: "transactional", subject: "Din kontrakt er valideret", bodyText: "DFKS har valideret din kontrakt. Du kan se resultatet i portalen.", path: `/portal/mine-kontrakter?contract=${contractId}`, entityType: "contract", entityId: contractId });
    } catch (notificationError) {
      console.error("[notification] valideringsmail kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function validateAdminContracts(contractIds: string[]) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const ids = [...new Set(contractIds)].slice(0, 200);
  if (!ids.length) return { success: true, count: 0 };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const { data: contracts, error: fetchError } = await db.from("contracts").select("id,status,work_id,rights_holder_id").eq("org_id", orgId).in("id", ids);
  if (fetchError) return { success: false, error: fetchError.message };
  for (const contract of contracts ?? []) {
    const blocker = await contractValidationBlocker(db, contract);
    if (blocker) return { success: false, error: blocker };
  }
  const toValidate = (contracts ?? []).filter(contract => contract.status !== "valideret");
  if (toValidate.length) {
    const writeDb = createServiceClient({ audit: {
      actorUserId: user.id,
      actorOrgId: orgId,
      source: "admin",
      correlationId: crypto.randomUUID(),
    } });
    const { error } = await writeDb.rpc("validate_contracts_explicitly", {
      p_actor_user_id: user.id,
      p_org_id: orgId,
      p_contract_ids: toValidate.map(contract => contract.id),
    });
    if (error) return { success: false, error: error.message };
  }
  for (const contract of toValidate) {
    if (!contract.rights_holder_id) continue;
    try {
      await sendMemberNotification({ eventKey: `contract-validated:${contract.id}`, eventType: "contract_validated", orgId, rightsHolderId: contract.rights_holder_id, category: "transactional", subject: "Din kontrakt er valideret", bodyText: "DFKS har valideret din kontrakt. Du kan se resultatet i portalen.", path: `/portal/mine-kontrakter?contract=${contract.id}`, entityType: "contract", entityId: contract.id });
    } catch (notificationError) {
      console.error("[notification] bulk-valideringsmail kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  return { success: true, count: toValidate.length };
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

export async function createAdminEmployer(params: { name: string; cvr?: string | null }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) {
    return { success: false, error: "Ikke autoriseret" };
  }

  const normalizedCvr = params.cvr?.replace(/\D/g, "") || null;
  if (normalizedCvr && !/^\d{8}$/.test(normalizedCvr)) return { success: false, error: "Et CVR-nummer skal bestå af 8 cifre" };
  if (normalizedCvr) {
    const { data: existingRegistration } = await db.from("employer_legal_entities").select("employer_id").eq("registration_country", "DK").eq("registration_type", "CVR").eq("registration_number", normalizedCvr).maybeSingle();
    if (existingRegistration) return { success: false, error: "CVR-nummeret er allerede registreret under et andet kanonisk selskab" };
  }
  const { data, error } = await db
    .from("employers")
    .insert({
      name: params.name.trim(),
      cvr: normalizedCvr,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  if (normalizedCvr) {
    const legal = await db.from("employer_legal_entities").insert({ employer_id: data.id, legal_name: data.name, registration_country: "DK", registration_type: "CVR", registration_number: normalizedCvr, entity_kind: "company", is_primary: true, created_by: user.id });
    if (legal.error && legal.error.code !== "42P01" && legal.error.code !== "PGRST205") {
      await db.from("employers").delete().eq("id", data.id);
      return { success: false, error: legal.error.message };
    }
  }
  return { success: true, employer: data };
}

export async function checkRightsHolderName(name: string) {
  try {
    const res = await tjekNavn(name);
    return { success: true, result: res };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Navnetjek fejlede" };
  }
}
