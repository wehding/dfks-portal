"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { tjekNavn } from "@/lib/rettighedshaver-tjek";
import { mergeContractWorkData, type LinkedContractWorkData } from "@/lib/contract-work-data";
import { parseLocalEpisodeCode } from "@/lib/series-episodes";

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
  season?: number;
  episodes?: { number: number; role: string }[];
  coversWholeSeason?: boolean;
  deferAiJob?: boolean;
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
      episode_numbers: params.season
        ? params.coversWholeSeason
          ? []
          : params.episodes?.map(episode => episode.number).filter(number => Number.isInteger(number) && number > 0) ?? []
        : null,
    })
    .select()
    .single();

  if (dbErr || !saved) return { success: false, error: dbErr?.message ?? "Kunne ikke gemme kontrakten" };

  const { error: validationError } = await db.from("contract_validations").insert({
    contract_id: saved.id,
    org_id: orgId,
    notes: JSON.stringify({
      memberName: rh.full_name ?? params.memberName,
      workTitle: params.workTitle,
      workId: params.workId,
      productionType: params.category || undefined,
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

  if (!params.deferAiJob) {
    const { error: jobError } = await db.from("contract_ai_jobs").insert({
      contract_id: saved.id,
      org_id: orgId,
      status: "queued",
      priority: 0,
    });

    if (jobError) {
      console.error("Kunne ikke oprette AI-job for uploadet kontrakt:", jobError);
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
    .select("id")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();
  if (!contract) return { success: false, error: "Kontrakten blev ikke fundet" };

  const { data: existing } = await db
    .from("contract_ai_jobs")
    .select("id")
    .eq("contract_id", contractId)
    .in("status", ["queued", "processing"])
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
  return { success: true, alreadyQueued: false };
}

export async function linkContractToWork(
  contractId: string,
  workId: string | null,
  scope?: { seasonNumber?: number | null; episodeNumbers?: number[] | null }
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
    .select("id, org_id")
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

  const { error } = await db
    .from("contracts")
    .update({
      work_id: workId,
      season_number: workId && scope?.seasonNumber ? scope.seasonNumber : null,
      episode_numbers: workId && scope?.seasonNumber
        ? [...new Set((scope.episodeNumbers ?? []).filter(number => Number.isInteger(number) && number > 0))]
        : null,
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
    .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, working_title, created_at, works(id, title, year, type), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at), contract_attachments(id, type, title, pdf_url, created_at), contract_comments(id, author_role, message, created_at, member_read_at, admin_read_at)")
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

export async function getContractValidation(contractId: string) {
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
  if (relatedWork && contract.rights_holder_id) {
    const parentId = relatedWork.parent_work_id ?? relatedWork.id;
    const { data: relatedWorks } = await db
      .from("works")
      .select("id, title, season_number, episode_number, parent_work_id")
      .eq("org_id", contract.org_id)
      .or(`id.eq.${parentId},parent_work_id.eq.${parentId}`);
    const episodeWorks = (relatedWorks ?? []).filter(item => item.episode_number != null || parseLocalEpisodeCode(item.title));
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
      episodeOptions.push({ id: episode.id, title: episode.title, seasonNumber, episodeNumber });
      const isDirectContractEpisode = episode.id === relatedWork.id;
      if (!isDirectContractEpisode && !roleByWork.has(episode.id)) continue;
      linkedEpisodes.push({
        id: episode.id,
        title: episode.title,
        seasonNumber,
        episodeNumber,
        role: roleByWork.get(episode.id) ?? null,
      });
    }
    linkedEpisodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    episodeOptions.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  }

  const isSeriesWork = relatedWork?.type === "tv-serie" || relatedWork?.type === "dokumentar-serie" || Boolean(relatedWork?.parent_work_id);
  return { success: true, extractedData, linkedEpisodes, episodeOptions, isSeriesWork };
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
  const { data: relatedWorks, error: worksError } = await db
    .from("works")
    .select("id, title, season_number, episode_number, parent_work_id")
    .eq("org_id", contract.org_id)
    .or(`id.eq.${parentId},parent_work_id.eq.${parentId}`);
  if (worksError) return { success: false, error: worksError.message };

  const episodeWorks = (relatedWorks ?? []).filter(item => item.episode_number != null || parseLocalEpisodeCode(item.title));
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
  const role = (existing ?? []).find(item => item.role)?.role ?? "Klipper";
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

  const { error } = await db.from("contract_validations").upsert(
    {
      contract_id: params.contractId,
      org_id: contract.org_id,
      holiday_pay_rate: (ed.holidayPayRate as number) ?? null,
      beta_rate: (ed.betaRate as number) ?? null,
      has_overenskomst_incorporation: !!ed.collectiveAgreement,
      has_credit_clause: !!(ed.creditedRoles || ed.creditedFunction || mergedEd.hasCreditClause),
      notes: (ed.specialNotes as string) ?? null,
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
      member_read_at: null,
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

export async function createAdminEmployer(params: { name: string; cvr?: string | null }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) {
    return { success: false, error: "Ikke autoriseret" };
  }

  const { data, error } = await db
    .from("employers")
    .insert({
      name: params.name.trim(),
      cvr: params.cvr?.trim() || null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
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
