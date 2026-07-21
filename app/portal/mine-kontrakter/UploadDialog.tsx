"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Upload, X, Loader2, CheckCircle2, Sparkles, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { linkContractToWork, queueUploadedContractAiJob, saveUploadedContract } from "@/app/actions/member-contracts";
import { addManualWorkAndLinkContract, addWorkForMemberWithApproval, findManualWorkDuplicates, linkExistingWorkForMember, resolveUnifiedSearchResultDetails, searchWorksUnified, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTRACT_SCREENING_TEXT } from "@/lib/profile-copy";
import { CONTRACT_CATEGORY_TO_WORK_TYPE, contractDataToManualWorkSeed, contractWorkTypeFilter, emptyManualWorkForm, isManualSeries, validateManualWork, type ManualWorkFormValue } from "@/lib/manual-work";
import { WorkSelectionPanel } from "@/components/works/work-selection-panel";

const BUCKET = "kontrakter";
const MAX_FILES = 15;

const ROLES = ["Klipper", "Film Editor", "Klippeassistent", "Dramaturg", "Klipper/Instruktør"];
const SERIES_CATEGORIES = ["tvSeries", "docSeries", "tvEntertainment", "reality", "sport"];
const CATEGORY_LABELS: Record<string, string> = {
  feature: "Spillefilm", short: "Kortfilm", tvSeries: "TV-serie",
  documentary: "Dokumentar", docSeries: "Dokumentarserie",
  tvEntertainment: "TV-underholdning", reality: "Reality", sport: "Sport",
};
type Props = {
  onClose: () => void;
  onUploaded: (contracts: UploadedContract[]) => void;
  workId?: string;
  workTitle?: string;
  myWorks?: MyWork[];
  rightsHolderId: string;
};

type MyWork = { id: string; title: string; year: number | null; type?: string };

type UploadedContract = {
  id: string;
  type: string | null;
  status: string;
  pdf_url: string | null;
  created_at: string | null;
  working_title?: string | null;
  work_id?: string | null;
  linked_work_title?: string | null;
  work_pending?: boolean;
};

type UploadStage = "checking" | "uploading" | "saving" | "linking" | "finishing";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Ukendt fejl";
}

export default function UploadDialog({ onClose, onUploaded, workId, workTitle, myWorks = [], rightsHolderId }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [screening, setScreening] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState(workTitle ?? "");
  const [selectedWorkId, setSelectedWorkId] = useState(workId ?? "");
  const [workSearch, setWorkSearch] = useState(workTitle ?? "");
  const [category, setCategory] = useState("");
  const [creditedRoles, setCreditedRoles] = useState<string[]>(["Klipper"]);
  const [episodeCredits, setEpisodeCredits] = useState<{ number: number; role: string }[]>([{ number: 1, role: "Klipper" }]);
  const [episodesTouched, setEpisodesTouched] = useState(false);
  const [duration, setDuration] = useState("");
  const [premiereDate, setPremiereDate] = useState("");
  const [productionCompany, setProductionCompany] = useState("");
  const [director, setDirector] = useState("");
  const [seriesSeason, setSeriesSeason] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualWork, setManualWork] = useState<ManualWorkFormValue>(emptyManualWorkForm());
  const [manualDuplicateMatches, setManualDuplicateMatches] = useState<Array<{ id: string; title: string; type: string; year: number | null; poster_url: string | null }>>([]);
  const [manualLinkRetry, setManualLinkRetry] = useState<{ contract: UploadedContract; workId: string; pending: boolean } | null>(null);
  const [attachmentRetry, setAttachmentRetry] = useState<{ contract: UploadedContract; forceDuplicate: boolean; linkedWorkId?: string | null; pending?: boolean } | null>(null);
  const [unifiedResults, setUnifiedResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [pickedUnifiedResult, setPickedUnifiedResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const manualSeededRef = React.useRef(false);
  const autoSearchKeyRef = React.useRef("");

  const file = files[0] ?? null;
  const isBatchUpload = files.length > 1;
  const isSeries = SERIES_CATEGORIES.includes(category);
  const selectedWork = selectedWorkId
    ? myWorks.find(w => w.id === selectedWorkId) ?? { id: selectedWorkId, title: workTitle ?? title, year: null }
    : null;
  const chosenWork = pickedUnifiedResult ?? selectedWork;

  // Hent varighed og kreditering fra det kendte værk
  useEffect(() => {
    if (!workId) return;
    (async () => {
      const supabase = createClient();

      const { data: work } = await supabase
        .from("works")
        .select("duration_minutes")
        .eq("id", workId)
        .single();
      if (work?.duration_minutes) {
        setDuration(String(work.duration_minutes));
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: rh } = await supabase
          .from("rettighedshavere")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (rh) {
          const { data: assignment } = await supabase
            .from("work_assignments")
            .select("role")
            .eq("work_id", workId)
            .eq("rights_holder_id", rh.id)
            .single();
          if (assignment?.role) {
            setCreditedRoles([assignment.role]);
          }
        }
      }
    })();
  }, [workId]);

  const handleFiles = useCallback((incoming: File[]) => {
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    const valid = incoming.filter(f => allowed.includes(f.type) || /\.(pdf|doc|docx)$/i.test(f.name));
    const rejected = incoming.length - valid.length;

    if (rejected > 0) toast.error("Kun PDF og DOCX understøttes");
    if (valid.length === 0) return;

    const limited = valid.slice(0, MAX_FILES);
    if (valid.length > MAX_FILES) toast.error(`Du kan højst vælge ${MAX_FILES} kontrakter ad gangen`);

    setFiles(limited);
    setEpisodesTouched(false);
    setWorkPickerOpen(false);
    setManualMode(false);
    setManualWork(emptyManualWorkForm());
    setManualDuplicateMatches([]);
    setManualLinkRetry(null);
    setAttachmentRetry(null);
    setUnifiedResults([]);
    setPickedUnifiedResult(null);
    setHasSearched(false);
    setSearchError(null);
    manualSeededRef.current = false;
    autoSearchKeyRef.current = "";
    const first = limited[0];
    if (first.type === "application/pdf" || /\.pdf$/i.test(first.name)) setPdfUrl(URL.createObjectURL(first));
    else setPdfUrl(null);
  }, []);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setScreening(true);
    setAiFields(new Set());
    (async () => {
      try {
        const { extractTextFromFile, screenPortalContract } = await import("@/lib/ai");
        const { maskPersonalData } = await import("@/lib/mask-text");
        const rawText = await extractTextFromFile(file);
        const text = maskPersonalData(rawText);
        if (cancelled) return;
        const result = await screenPortalContract(text, ROLES);
        if (cancelled) return;
        const filled = new Set<string>();
        if (result.title && !workTitle) {
          setTitle(result.title);
          setWorkSearch(prev => prev || result.title || "");
          filled.add("title");
        }
        if (result.category && CATEGORY_LABELS[result.category]) { setCategory(result.category); filled.add("category"); }
        let screenedRole = "Klipper";
        if (result.creditedRole) {
          const match = ROLES.find(r => r.toLowerCase() === result.creditedRole!.toLowerCase());
          if (match) { screenedRole = match; setCreditedRoles([match]); filled.add("creditedRole"); }
        }
        if (result.premiereDate) { setPremiereDate(result.premiereDate); filled.add("premiereDate"); }
        if (result.duration && result.duration > 0) { setDuration(String(result.duration)); filled.add("duration"); }
        if (result.productionCompany) { setProductionCompany(result.productionCompany); filled.add("productionCompany"); }
        if (result.director) { setDirector(result.director); filled.add("director"); }
        if (result.seasonNumber && result.seasonNumber > 0) { setSeriesSeason(String(result.seasonNumber)); filled.add("seasonNumber"); }
        if (result.episodes?.length) {
          setEpisodeCredits(result.episodes.map(episode => ({ number: episode.number, role: screenedRole })));
          filled.add("episodes");
        }
        setAiFields(filled);
        if (filled.size > 0) toast.success(`${filled.size} felt${filled.size > 1 ? "er" : ""} udfyldt automatisk — kontrollér og ret`);
      } catch (e: unknown) {
        if (!cancelled) toast.error(`Screening fejlede: ${errorText(e)}`);
      } finally {
        if (!cancelled) setScreening(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, workTitle]);

  const canSubmit = files.length > 0 && !!title && !screening && !saving &&
    (isSeries ? episodeCredits.some(e => e.role) : creditedRoles.some(Boolean));

  const buildManualSeed = useCallback((contractId?: string | null) => contractDataToManualWorkSeed({
    title: title.trim() || workSearch.trim(),
    category,
    duration,
    premiereDate,
    productionCompany,
    director,
    seasonNumber: seriesSeason,
    episodes: isSeries && (aiFields.has("episodes") || episodesTouched) ? episodeCredits : [],
    contractId,
  }), [aiFields, category, director, duration, episodeCredits, episodesTouched, isSeries, premiereDate, productionCompany, seriesSeason, title, workSearch]);

  const handleWorkSearch = useCallback(async (queryOverride?: string, preferredTypeOverride?: string | null) => {
    const query = queryOverride?.trim() || workSearch.trim() || title.trim();
    if (!query) return;
    setIsSearching(true);
    setHasSearched(true);
    setSearchError(null);
    setUnifiedResults([]);
    setPickedUnifiedResult(null);
    try {
      const result = await searchWorksUnified(query);
      if (!result.success) {
        setSearchError("Søgningen mislykkedes. Prøv igen.");
        return;
      }
      const results = result.results ?? [];
      setUnifiedResults(results);
      setTypeFilter(preferredTypeOverride
        ? (results.some(item => item.type === preferredTypeOverride) ? preferredTypeOverride : "all")
        : contractWorkTypeFilter(category, results));
    } catch (error) {
      console.error("Værkssøgning i kontraktupload fejlede", error);
      setSearchError("Søgningen mislykkedes. Prøv igen.");
    } finally {
      setIsSearching(false);
    }
  }, [category, title, workSearch]);

  useEffect(() => {
    if (
      !file
      || screening
      || isBatchUpload
      || selectedWorkId
      || pickedUnifiedResult
      || hasSearched
      || !aiFields.has("title")
    ) return;

    const query = (workSearch.trim() || title.trim());
    if (!query) return;
    const preferredType = CONTRACT_CATEGORY_TO_WORK_TYPE[category] ?? null;
    const searchKey = `${file.name}:${file.size}:${query}:${preferredType ?? "all"}`;
    if (autoSearchKeyRef.current === searchKey) return;
    autoSearchKeyRef.current = searchKey;

    setWorkPickerOpen(true);
    if (!manualSeededRef.current) {
      setManualWork(emptyManualWorkForm(buildManualSeed()));
      manualSeededRef.current = true;
    }
    void handleWorkSearch(query, preferredType);
  }, [aiFields, buildManualSeed, category, file, handleWorkSearch, hasSearched, isBatchUpload, pickedUnifiedResult, screening, selectedWorkId, title, workSearch]);

  const openWorkPicker = () => {
    setWorkPickerOpen(true);
    if (!manualSeededRef.current) {
      setManualWork(emptyManualWorkForm(buildManualSeed()));
      manualSeededRef.current = true;
    }
    if (!hasSearched && (workSearch.trim() || title.trim())) {
      window.setTimeout(() => void handleWorkSearch(), 0);
    }
  };

  const saveContracts = async () => {
    if (files.length === 0 || !title) return null;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Ikke logget ind"); return null; }

      const { data: orgRole } = await supabase.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
      const orgId = orgRole?.org_id;
      if (!orgId) { toast.error("Din bruger er ikke knyttet til en organisation"); return null; }

      const { data: rhRow } = await supabase.from("rettighedshavere").select("id, full_name").eq("user_id", user.id).single();
      if (!rhRow) { toast.error("Ingen rettighedshaver-profil"); return null; }

      const roles = isSeries
        ? [...new Set(episodeCredits.filter(e => e.role).map(e => e.role))]
        : creditedRoles.filter(Boolean);

      const savedContracts: UploadedContract[] = [];

      for (const [index, selectedFile] of files.entries()) {
        setUploadStage("uploading");
        const filePath = `${orgId}/${Date.now()}_${index}_${selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: storageErr } = await supabase.storage.from(BUCKET).upload(filePath, selectedFile, { contentType: selectedFile.type });
        if (storageErr) { toast.error(`Upload fejlede for ${selectedFile.name}: ${storageErr.message}`); return null; }

        setUploadStage("saving");
        const res = await saveUploadedContract({
          filePath, orgId, rhId: rhRow.id, memberName: rhRow.full_name,
          workTitle: isBatchUpload ? title.trim() : selectedWork?.title ?? title.trim(),
          workId: isBatchUpload ? undefined : selectedWorkId || undefined,
          category, roles,
          duration: duration ? Number(duration) : undefined,
          premiereDate: premiereDate || undefined,
          season: isSeries && seriesSeason ? Number(seriesSeason) : undefined,
          episodes: isSeries ? episodeCredits.filter(e => e.role) : undefined,
          deferAiJob: !isBatchUpload && Boolean(manualMode || pickedUnifiedResult),
        });

        if (!res.success) { toast.error(res.error ?? `Kunne ikke gemme ${selectedFile.name}`); return null; }
        savedContracts.push(res.contract);
      }

      return savedContracts;
    } catch (e: unknown) {
      toast.error(errorText(e) || "Fejl ved upload");
      return null;
    } finally {
      setSaving(false);
      setUploadStage(null);
    }
  };

  const selectedEpisodeNumbers = () => [...new Set(episodeCredits.map(episode => episode.number).filter(number => Number.isInteger(number) && number > 0))];

  const attachSelectedWork = async (contract: UploadedContract, forceDuplicate: boolean) => {
    const role = (isSeries ? episodeCredits.find(episode => episode.role)?.role : creditedRoles.find(Boolean)) ?? "Klipper";

    if (manualMode) {
      const manualEpisodeNumber = Number(manualWork.episode_number) || null;
      const manualEpisodeCount = Number(manualWork.episode_count) || (isManualSeries(manualWork) ? manualEpisodeNumber : null);
      const result = await addManualWorkAndLinkContract({
        rightsHolderId,
        role,
        comment: "",
        contractId: contract.id,
        forceCreateDuplicate: forceDuplicate,
        workData: {
          title: manualWork.title.trim(),
          type: manualWork.type,
          year: Number(manualWork.year),
          duration_minutes: Number(manualWork.duration_minutes) || null,
          episode_count: manualEpisodeCount,
          season_number: Number(manualWork.season_number) || 1,
          episode_number: manualEpisodeNumber,
          selected_episodes: manualWork.selected_episodes,
          director: manualWork.director.trim() || null,
          production_companies: manualWork.production_company.trim() ? [manualWork.production_company.trim()] : [],
          description: null,
        },
      });
      if (!result.success) {
        if ("duplicate" in result && result.duplicate && "matches" in result && Array.isArray(result.matches)) {
          setManualDuplicateMatches(result.matches);
          return { success: false as const, handled: true as const };
        }
        if (result.workId && result.retryable) {
          setManualLinkRetry({ contract, workId: result.workId, pending: Boolean(result.pending) });
        }
        return { success: false as const, error: result.error ?? "Kunne ikke oprette og linke værket." };
      }
      return { success: true as const, workId: result.workId, pending: Boolean(result.pending) };
    }

    if (!pickedUnifiedResult) {
      return { success: true as const, workId: selectedWorkId || null, pending: false };
    }

    const selectedEpisodes = selectedEpisodeNumbers();
    const seasonNumber = isSeries ? Number(seriesSeason) || 1 : null;
    if (pickedUnifiedResult.local_id) {
      const linked = await linkExistingWorkForMember({
        rightsHolderId,
        workId: pickedUnifiedResult.local_id,
        role,
        seasonNumber,
        episodeNumber: selectedEpisodes.length === 1 ? selectedEpisodes[0] : null,
        selectedEpisodes,
      });
      if (!linked.success) return { success: false as const, error: linked.error ?? "Kunne ikke vælge værket." };
      const workIdToLink = linked.workId ?? pickedUnifiedResult.local_id;
      const contractLink = await linkContractToWork(contract.id, workIdToLink);
      if (!contractLink.success) return { success: false as const, error: contractLink.error ?? "Kontrakten kunne ikke tilknyttes værket." };
      return { success: true as const, workId: workIdToLink, pending: Boolean(linked.pending) };
    }

    const detailsResult = await resolveUnifiedSearchResultDetails(pickedUnifiedResult);
    if (!detailsResult.success || !detailsResult.details) {
      return { success: false as const, error: "Kunne ikke hente detaljer for det valgte værk." };
    }
    const details = detailsResult.details;
    const created = await addWorkForMemberWithApproval({
      rightsHolderId,
      role,
      comment: "",
      source: pickedUnifiedResult.sources.includes("dfi") ? "dfi" : "tmdb",
      workData: {
        dfi_id: details.dfi_id ? String(details.dfi_id) : null,
        tmdb_id: details.tmdb_id ? Number(details.tmdb_id) : null,
        imdb_id: details.imdb_id ?? null,
        wikidata_id: details.wikidata_id ?? null,
        title: details.title,
        type: details.type,
        year: details.year,
        duration_minutes: details.duration_minutes,
        episode_count: details.episode_count,
        season_number: seasonNumber,
        episode_number: selectedEpisodes.length === 1 ? selectedEpisodes[0] : null,
        selected_episodes: selectedEpisodes,
        director: details.director,
        production_companies: details.production_companies,
        genre: details.genre,
        description: details.description,
        poster_url: details.poster_url,
        dfi_metadata: details.dfi_metadata,
      },
    });
    if (!created.success || !created.workId) return { success: false as const, error: created.error ?? "Kunne ikke tilføje værket." };
    const contractLink = await linkContractToWork(contract.id, created.workId);
    if (!contractLink.success) return { success: false as const, error: contractLink.error ?? "Kontrakten kunne ikke tilknyttes værket." };
    return { success: true as const, workId: created.workId, pending: "pending" in created && Boolean(created.pending) };
  };

  const completeUpload = (savedContracts: UploadedContract[], linkedWorkId?: string | null, pending = false) => {
    const linkedTitle = manualMode ? manualWork.title.trim() : pickedUnifiedResult?.title ?? selectedWork?.title ?? null;
    const normalized = savedContracts.map((contract, index) => index === 0 && linkedWorkId
      ? { ...contract, work_id: linkedWorkId, linked_work_title: linkedTitle, work_pending: pending }
      : contract);
    toast.success(pending
      ? "Kontrakten er gemt, og værket afventer admin-godkendelse."
      : files.length === 1 ? "Kontrakt indsendt til DFKS" : `${files.length} kontrakter indsendt til DFKS`);
    onUploaded(normalized);
  };

  const handleSubmit = async (forceDuplicate = false) => {
    if (manualLinkRetry) {
      await retryManualLink();
      return;
    }
    if (attachmentRetry) {
      await retryAttachment();
      return;
    }
    if (manualMode) {
      const validationError = validateManualWork(manualWork, "da");
      if (validationError) { toast.error(validationError); return; }
      setSaving(true);
      setUploadStage("checking");
      if (!forceDuplicate) {
        const duplicateResult = await findManualWorkDuplicates(manualWork.title, Number(manualWork.year));
        if (!duplicateResult.success) {
          setSaving(false);
          setUploadStage(null);
          toast.error(duplicateResult.error ?? "Kunne ikke kontrollere for eksisterende værker.");
          return;
        }
        if (duplicateResult.matches.length > 0) {
          setSaving(false);
          setUploadStage(null);
          setManualDuplicateMatches(duplicateResult.matches);
          return;
        }
      }
      setManualDuplicateMatches([]);
    }

    const savedContracts = await saveContracts();
    if (!savedContracts) return;
    if (savedContracts.length !== 1 || (!manualMode && !pickedUnifiedResult)) {
      completeUpload(savedContracts, selectedWorkId || null);
      return;
    }

    setSaving(true);
    setUploadStage("linking");
    try {
      const attached = await attachSelectedWork(savedContracts[0], forceDuplicate);
      if (!attached.success) {
        setAttachmentRetry({ contract: savedContracts[0], forceDuplicate });
        if (!("handled" in attached && attached.handled)) toast.error(attached.error ?? "Værket kunne ikke tilknyttes.");
        return;
      }
      setUploadStage("finishing");
      const queued = await queueUploadedContractAiJob(savedContracts[0].id);
      if (!queued.success) {
        setAttachmentRetry({ contract: savedContracts[0], forceDuplicate, linkedWorkId: attached.workId, pending: attached.pending });
        toast.error(queued.error ?? "Kontrakten blev linket, men den automatiske gennemgang kunne ikke startes.");
        return;
      }
      setManualLinkRetry(null);
      setAttachmentRetry(null);
      completeUpload(savedContracts, attached.workId, attached.pending);
    } finally {
      setSaving(false);
      setUploadStage(null);
    }
  };

  const retryManualLink = async () => {
    if (!manualLinkRetry) return;
    setSaving(true);
    setUploadStage("linking");
    try {
      const result = await addManualWorkAndLinkContract({
        rightsHolderId,
        role: (isSeries ? episodeCredits.find(episode => episode.role)?.role : creditedRoles.find(Boolean)) ?? "Klipper",
        comment: "",
        contractId: manualLinkRetry.contract.id,
        reuseWorkId: manualLinkRetry.workId,
        reusePending: manualLinkRetry.pending,
        workData: {
          title: manualWork.title,
          type: manualWork.type,
          year: Number(manualWork.year),
          duration_minutes: Number(manualWork.duration_minutes) || null,
          description: null,
        },
      });
      if (!result.success) { toast.error(result.error ?? "Kontrakten kunne stadig ikke tilknyttes."); return; }
      const contract = manualLinkRetry.contract;
      setUploadStage("finishing");
      const queued = await queueUploadedContractAiJob(contract.id);
      if (!queued.success) { toast.error(queued.error ?? "Værket blev linket, men den automatiske gennemgang kunne ikke startes."); return; }
      setManualLinkRetry(null);
      setAttachmentRetry(null);
      completeUpload([contract], result.workId, Boolean(result.pending));
    } finally {
      setSaving(false);
      setUploadStage(null);
    }
  };

  const retryAttachment = async () => {
    if (!attachmentRetry) return;
    setSaving(true);
    setUploadStage(attachmentRetry.linkedWorkId ? "finishing" : "linking");
    try {
      if (attachmentRetry.linkedWorkId) {
        const queued = await queueUploadedContractAiJob(attachmentRetry.contract.id);
        if (!queued.success) { toast.error(queued.error ?? "Den automatiske gennemgang kunne ikke startes."); return; }
        const completedRetry = attachmentRetry;
        setAttachmentRetry(null);
        completeUpload([completedRetry.contract], completedRetry.linkedWorkId, Boolean(completedRetry.pending));
        return;
      }
      const attached = await attachSelectedWork(attachmentRetry.contract, attachmentRetry.forceDuplicate);
      if (!attached.success) {
        if (!("handled" in attached && attached.handled)) toast.error(attached.error ?? "Værket kunne stadig ikke tilknyttes.");
        return;
      }
      setUploadStage("finishing");
      const queued = await queueUploadedContractAiJob(attachmentRetry.contract.id);
      if (!queued.success) { toast.error(queued.error ?? "Den automatiske gennemgang kunne ikke startes."); return; }
      const contract = attachmentRetry.contract;
      setAttachmentRetry(null);
      setManualLinkRetry(null);
      completeUpload([contract], attached.workId, attached.pending);
    } finally {
      setSaving(false);
      setUploadStage(null);
    }
  };

  // Fælles select-stil (shadcn Select er overkill her — native select er tilstrækkeligt)
  const selectCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div
      className="fixed inset-0 bg-black/45 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`flex max-h-[96svh] w-full overflow-hidden rounded-t-xl border bg-background text-foreground shadow-lg transition-all duration-300 sm:max-h-[92vh] sm:rounded-xl ${pdfUrl ? "max-w-4xl" : "max-w-lg"}`}>

        {/* PDF preview */}
        {pdfUrl && (
          <div className="hidden flex-1 bg-muted border-r min-w-0 md:block">
            <iframe src={`${pdfUrl}#navpanes=0`} className="w-full h-full border-0" title="Forhåndsvisning" />
          </div>
        )}

        {/* Formular */}
        <div className={`${pdfUrl ? "w-full md:w-[420px]" : "w-full"} flex shrink-0 flex-col gap-5 overflow-y-auto p-4 sm:p-7`}>

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Upload kontrakt</h2>
              <p className="text-sm text-muted-foreground mt-1">Du kan godt uploade flere kontrakter ad gangen.</p>
              {workTitle && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  til <strong className="text-foreground">{workTitle}</strong>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          {pdfUrl && (
            <Button type="button" variant="outline" onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")} className="md:hidden">
              Åbn forhåndsvisning
            </Button>
          )}

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
            className={`rounded-lg border-2 border-dashed p-7 text-center transition-colors ${isDragging ? "border-primary/60 bg-primary/10" : "border-border hover:border-muted-foreground/40"}`}
          >
            <Upload className="mx-auto h-7 w-7 text-muted-foreground/50 mb-2.5" />
            <p className="text-sm text-muted-foreground mb-2">Træk fil hertil eller</p>
            <label className="cursor-pointer">
              <input type="file" accept=".pdf,.doc,.docx" multiple className="hidden" onChange={e => e.target.files && handleFiles(Array.from(e.target.files))} />
              <span className="text-sm font-medium px-4 py-1.5 rounded-md border hover:bg-muted transition-colors cursor-pointer">
                Vælg filer
              </span>
            </label>
            <p className="text-xs text-muted-foreground mt-2">PDF eller DOCX. Maks. {MAX_FILES} filer.</p>
          </div>

          {/* Fil + screening-status */}
          {files.length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center gap-3">
                {screening
                  ? <Loader2 className="h-4 w-4 shrink-0 text-purple-600 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{file?.name}</p>
                  {isBatchUpload && <p className="text-xs text-muted-foreground mt-0.5">Kontrakt 1 af {files.length} - systemet forsøger automatisk at koble alle kontrakterne til værker</p>}
                  {screening && (
                    <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> {CONTRACT_SCREENING_TEXT}
                    </p>
                  )}
                </div>
                {!screening && (
                  <button
                    onClick={() => {
                      setFiles([]);
                      setPdfUrl(null);
                      setTitle(workTitle ?? "");
                      setSelectedWorkId(workId ?? "");
                      setWorkSearch(workTitle ?? "");
                      setCategory("");
                      setCreditedRoles(["Klipper"]);
                      setEpisodeCredits([{ number: 1, role: "Klipper" }]);
                      setEpisodesTouched(false);
                      setSeriesSeason("");
                      setDuration("");
                      setPremiereDate("");
                      setProductionCompany("");
                      setDirector("");
                      setAiFields(new Set());
                      setWorkPickerOpen(false);
                      setManualMode(false);
                      setManualWork(emptyManualWorkForm());
                      setManualDuplicateMatches([]);
                      setManualLinkRetry(null);
                      setAttachmentRetry(null);
                      setUnifiedResults([]);
                      setPickedUnifiedResult(null);
                      setHasSearched(false);
                      setSearchError(null);
                      manualSeededRef.current = false;
                      autoSearchKeyRef.current = "";
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {files.length > 1 && (
                <div className="mt-2 max-h-24 overflow-y-auto border-t pt-2">
                  {files.slice(1).map(extraFile => (
                    <p key={`${extraFile.name}-${extraFile.size}`} className="truncate text-xs text-muted-foreground">
                      {extraFile.name}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Formularfelter */}
          {file && !screening && (
            <div className="flex flex-col gap-4">

              {isBatchUpload && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  Systemet forsøger automatisk at koble kontrakterne til dine eksisterende værker. Du skal selv kontrollere, at hver kontrakt er knyttet til det rigtige værk. Kontrakter uden korrekt værktilknytning kan ikke bruges til rettighedsfordeling og udløser derfor ikke rettighedspenge.
                </div>
              )}

              {/* Titel */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  Produktionstitel
                  {aiFields.has("title") && <Sparkles className="h-3 w-3 text-purple-500" />}
                </Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Filmens eller seriens titel"
                  className={aiFields.has("title") ? "bg-purple-50" : ""}
                />
              </div>

              {/* Værkskobling */}
              {!isBatchUpload && (
              <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-3">
                <Label className="text-sm font-medium text-muted-foreground">
                  Vælg værk
                </Label>
                {chosenWork && !manualMode ? (
                  <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{chosenWork.title}</p>
                      {chosenWork.year && <p className="text-xs text-muted-foreground">{chosenWork.year}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkId("");
                        setPickedUnifiedResult(null);
                        setWorkPickerOpen(true);
                      }}
                      className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : !workPickerOpen ? (
                  <Button type="button" variant="outline" size="sm" onClick={openWorkPicker} disabled={saving || screening} className="w-full">
                    Søg i databasen eller indtast manuelt
                  </Button>
                ) : null}

                {workPickerOpen && (!chosenWork || manualMode) && (
                  <WorkSelectionPanel
                    query={workSearch}
                    onQueryChange={setWorkSearch}
                    onSearch={() => void handleWorkSearch()}
                    isSearching={isSearching}
                    hasSearched={hasSearched}
                    searchError={searchError}
                    results={unifiedResults}
                    selectedId={pickedUnifiedResult?.id}
                    onSelect={result => {
                      setPickedUnifiedResult(result);
                      setSelectedWorkId(result.local_id ?? "");
                      setManualMode(false);
                      setManualDuplicateMatches([]);
                    }}
                    typeFilter={typeFilter}
                    onTypeFilterChange={setTypeFilter}
                    manualMode={manualMode}
                    onManualModeChange={manual => {
                      setManualMode(manual);
                      if (manual) {
                        setPickedUnifiedResult(null);
                        setSelectedWorkId("");
                      }
                    }}
                    manualWork={manualWork}
                    onManualWorkChange={value => {
                      setManualWork(value);
                      setManualDuplicateMatches([]);
                    }}
                    locale="da"
                    manualExtra={(
                      <>
                        {manualDuplicateMatches.length > 0 && (
                          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                            <p className="font-medium">Der findes allerede et værk med samme titel og premiereår.</p>
                            <div className="mt-3 flex flex-col gap-2">
                              {manualDuplicateMatches.map(match => (
                                <Button
                                  key={match.id}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setPickedUnifiedResult({
                                      id: `local:${match.id}`,
                                      local_id: match.id,
                                      title: match.title,
                                      type: match.type,
                                      year: match.year,
                                      poster_url: match.poster_url,
                                      description: null,
                                      director: null,
                                      genre: null,
                                      duration_minutes: null,
                                      sources: ["local"],
                                    });
                                    setSelectedWorkId(match.id);
                                    setManualMode(false);
                                    setManualDuplicateMatches([]);
                                  }}
                                >
                                  Vælg eksisterende værk
                                </Button>
                              ))}
                              <Button type="button" size="sm" onClick={() => void handleSubmit(true)} disabled={saving}>
                                Opret nyt alligevel – kræver godkendelse
                              </Button>
                            </div>
                          </div>
                        )}
                        {manualLinkRetry && (
                          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                            <p>Værket er oprettet, men kontrakten mangler stadig at blive linket. Retry genbruger værket.</p>
                            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void retryManualLink()} disabled={saving}>
                              Prøv at linke igen
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  />
                )}
                {attachmentRetry && !manualLinkRetry && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>Kontrakten er gemt, men værket eller den automatiske gennemgang mangler at blive færdigkoblet. Retry genbruger den gemte kontrakt.</p>
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void retryAttachment()} disabled={saving}>
                      Prøv igen
                    </Button>
                  </div>
                )}
              </div>
              )}

              {/* Kategori */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  Kategori
                  {aiFields.has("category") && <Sparkles className="h-3 w-3 text-purple-500" />}
                </Label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={`${selectCls} ${aiFields.has("category") ? "bg-purple-50" : ""}`}
                >
                  <option value="">—</option>
                  {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {/* Kreditering */}
              {!isSeries ? (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                    Krediteret funktion
                    {aiFields.has("creditedRole") && <Sparkles className="h-3 w-3 text-purple-500" />}
                  </Label>
                  {creditedRoles.map((role, idx) => (
                    <div key={idx} className="flex gap-2 mb-1.5">
                      <select
                        value={role}
                        onChange={e => setCreditedRoles(prev => prev.map((r, i) => i === idx ? e.target.value : r))}
                        className={`${selectCls} flex-1`}
                      >
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {creditedRoles.length > 1 && (
                        <button
                          onClick={() => setCreditedRoles(prev => prev.filter((_, i) => i !== idx))}
                          className="px-2.5 rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setCreditedRoles(prev => [...prev, ""])}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tilføj kreditering
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Sæson
                      {aiFields.has("seasonNumber") && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={seriesSeason}
                      onChange={event => setSeriesSeason(event.target.value)}
                      placeholder="1"
                      className={aiFields.has("seasonNumber") ? "bg-purple-50" : ""}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-muted-foreground">Afsnit og kreditering</Label>
                    <button
                      onClick={() => {
                        setEpisodesTouched(true);
                        setEpisodeCredits(prev => [...prev, { number: (prev.at(-1)?.number ?? 0) + 1, role: prev.at(-1)?.role ?? "Klipper" }]);
                      }}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border hover:bg-muted"
                    >
                      <Plus className="h-3 w-3" /> Tilføj afsnit
                    </button>
                  </div>
                  {episodeCredits.map((ec, idx) => (
                    <div key={idx} className="grid gap-1.5 mb-1.5 items-center" style={{ gridTemplateColumns: "52px 1fr 32px" }}>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">#</span>
                        <input
                          type="number" value={ec.number} min={1}
                          onChange={e => {
                            setEpisodesTouched(true);
                            setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, number: parseInt(e.target.value) || 1 } : x));
                          }}
                          className="w-full pl-5 pr-2 py-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <select
                        value={ec.role}
                        onChange={e => {
                          setEpisodesTouched(true);
                          setEpisodeCredits(prev => prev.map((x, i) => i === idx ? { ...x, role: e.target.value } : x));
                        }}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        onClick={() => {
                          setEpisodesTouched(true);
                          setEpisodeCredits(prev => prev.filter((_, i) => i !== idx));
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Varighed / premieredato */}
              {!isSeries && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Varighed (min)
                      {aiFields.has("duration") && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    <Input
                      type="number" value={duration}
                      onChange={e => setDuration(e.target.value)}
                      placeholder="90"
                      className={aiFields.has("duration") ? "bg-purple-50" : ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Premieredato
                      {aiFields.has("premiereDate") && <Sparkles className="h-3 w-3 text-purple-500" />}
                    </Label>
                    <Input
                      type="date" value={premiereDate}
                      onChange={e => setPremiereDate(e.target.value)}
                      className={aiFields.has("premiereDate") ? "bg-purple-50" : ""}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    Produktionsselskab
                    {aiFields.has("productionCompany") && <Sparkles className="h-3 w-3 text-purple-500" />}
                  </Label>
                  <Input
                    value={productionCompany}
                    onChange={e => setProductionCompany(e.target.value)}
                    placeholder="Produktionsselskab"
                    className={aiFields.has("productionCompany") ? "bg-purple-50" : ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    Instruktør
                    {aiFields.has("director") && <Sparkles className="h-3 w-3 text-purple-500" />}
                  </Label>
                  <Input
                    value={director}
                    onChange={e => setDirector(e.target.value)}
                    placeholder="Instruktør"
                    className={aiFields.has("director") ? "bg-purple-50" : ""}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Upload-knap */}
          {file && !screening && (
            <div className="flex flex-col gap-2.5">
              {saving && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {uploadStage === "checking" && "Kontrollerer værkoplysninger..."}
                    {uploadStage === "uploading" && `Uploader ${files.length === 1 ? "kontrakt" : `${files.length} kontrakter`}...`}
                    {uploadStage === "saving" && `Gemmer ${files.length === 1 ? "kontrakt" : `${files.length} kontrakter`}...`}
                    {uploadStage === "linking" && "Tilknytter værk..."}
                    {uploadStage === "finishing" && "Starter automatisk gennemgang..."}
                    {!uploadStage && "Forbereder indsendelse..."}
                  </p>
                  <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ animation: "upload-progress 8s ease-out forwards" }} />
                  </div>
                  <style>{`@keyframes upload-progress{0%{width:0%}40%{width:55%}80%{width:85%}95%{width:93%}}`}</style>
                </div>
              )}
              <Button onClick={() => void handleSubmit(false)} disabled={!canSubmit} className="w-full gap-2">
                <Upload className="h-4 w-4" /> {isBatchUpload ? "Indsend kontrakter" : "Indsend"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
