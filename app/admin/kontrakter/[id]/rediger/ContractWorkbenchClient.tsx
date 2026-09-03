"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase relation payloads are normalized at this client boundary. */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BriefcaseBusiness, Building2, CheckCircle2, ChevronLeft, ChevronRight, Download, GripVertical, Loader2, Save, Scale, Scissors, Sparkles, Trash2, Tv, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { addAdminContractComment, deleteAdminContractsPermanently, getAdminContractSeriesEpisodeOptions, markContractCommentsRead, queueAdminContractAiExtraction, updateAdminContract } from "@/app/actions/member-contracts";
import { createAdminContractWorkQueue, fetchAdminContractWorkQueue, markAdminContractQueueItem } from "@/app/actions/admin-contract-work-queues";
import { createAdminWork, createAndLinkWorkForContract } from "@/app/actions/work-management";
import { resolveUnifiedSearchResultDetails, searchWorksUnified, type UnifiedSearchWorkResult } from "@/app/actions/member-works";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProductionCompanyPicker } from "@/components/production-company-picker";
import { ContractSourceBadge } from "@/components/contracts/contract-source-badge";
import { useAdminPageTitle } from "@/components/admin/admin-page-title";
import { WorkSelectionPanel } from "@/components/works/work-selection-panel";
import { contractDataToManualWorkSeed, contractWorkTypeFilter, emptyManualWorkForm, validateManualWork, type ManualWorkFormValue } from "@/lib/manual-work";
import { extractedProductionCompanyNames, type ProductionCompanySelection } from "@/lib/production-companies";
import { buildCompleteEpisodeOptions, mergeEpisodeOptionsByPriority, type SeriesEpisodeOption } from "@/lib/series-episodes";
import { parseSeasonNumberFromTitle } from "@/lib/dfi-metadata";
import { contractEpisodeNumbersFromLayout, contractEvidencePage, fieldEvidence, safeContractReturnTo, suggestLocalContractWork, type ContractDocumentVariant, type ContractEvidenceBbox, type ContractFieldEvidence, type ContractFieldSource, type ContractValidationMissingField, type ContractWorkbenchData } from "@/lib/contract-workbench";
import { CONTRACT_WORKBENCH_SPLIT_QUERY } from "@/lib/contract-workbench-responsive";
import type { ContractValidationSectionKey } from "@/app/actions/member-contracts";
import type { ContractEvidenceActivation } from "../../ContractAiDataEditor";
import type { ContractDocumentReviewAction, ContractDocumentReviewData } from "@/lib/contract-document-review";
import type { AdminContractQueueContext } from "@/lib/admin-contract-work-queue";
import { ContractOwnershipEditor } from "@/components/admin/contract-ownership-editor";
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread";

const PdfViewer = dynamic(() => import("@/components/pdf-viewer").then(mod => mod.PdfViewer), { ssr: false });
const ContractDocViewer = dynamic(() => import("../../ContractDocViewer").then(mod => mod.ContractDocViewer), { ssr: false });
const ContractAiDataEditor = dynamic(() => import("../../ContractAiDataEditor").then(mod => mod.ContractAiDataEditor), { ssr: false });
const ContractEvidencePreview = dynamic(() => import("@/components/contracts/contract-evidence-preview").then(mod => mod.ContractEvidencePreview), {
  ssr: false,
  loading: () => <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Henter kildeudsnit…</div>,
});

export type EditorData = ContractWorkbenchData<any>;

const APPROVAL_RIGHT_KEYS = ["copydan", "hasCreditClause", "royalty", "royaltyPercent", "svod"];
const APPROVAL_SIGNATURE_KEYS = ["signatureStatus", "signatureDate"];
const CLAUSE_EVIDENCE_KEYS = new Set(["collectiveAgreement", "copydan", "svod", "royalty", "creditedRoles", "hasCreditClause", "aiDataMiningClause", "futureRightsReservation"]);
const SPLIT_STORAGE_KEY = "dfks-contract-workbench-split";
const SECTIONS: Array<{ key: string; label: string; section?: ContractValidationSectionKey }> = [
  { key: "approve", label: "Godkend" },
  { key: "ownership", label: "Ejerskab" },
  { key: "messages", label: "Beskeder" },
  { key: "rights", label: "Rettigheder", section: "rights" },
  { key: "dates", label: "Dato", section: "dates" },
  { key: "salary", label: "Løn og periode", section: "salary" },
  { key: "series", label: "Afsnit og medklippere", section: "series" },
  { key: "signature", label: "Underskrift", section: "signature" },
  { key: "ids", label: "ID", section: "ids" },
  { key: "work", label: "Værksdata", section: "work" },
];

function DocumentProcessingReviewCard({
  review,
  loading,
  activeAction,
  statusMessage,
  onAction,
}: {
  review: ContractDocumentReviewData | null;
  loading: boolean;
  activeAction: ContractDocumentReviewAction | null;
  statusMessage: string | null;
  onAction: (action: ContractDocumentReviewAction) => void;
}) {
  if (!review && !statusMessage && !loading) return null;
  return <div className="m-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
    {review && <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{review.title}</p><p>{review.reason}</p><p className="font-medium">{review.affectedPagesText}</p></div></div>}
    {loading && <p className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Henter den seneste PDF-status…</p>}
    {review && (review.canRetry || review.canRequestRescan) && <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {review.canRetry && <Button type="button" variant="outline" className="min-h-11 w-full" disabled={Boolean(activeAction)} onClick={() => onAction("retry")}>{activeAction === "retry" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Prøv igen</Button>}
      {review.canRequestRescan && <Button type="button" variant="outline" className="min-h-11 w-full" disabled={Boolean(activeAction)} onClick={() => onAction("request_rescan")}>{activeAction === "request_rescan" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Markér: ny scanning nødvendig</Button>}
    </div>}
    {statusMessage && <p className="mt-2" aria-live="polite">{statusMessage}</p>}
  </div>;
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function triState(value: unknown) {
  if (value === true) return "yes";
  if (value === false) return "no";
  const normalized = String(value ?? "").toLowerCase();
  if (["yes", "ja", "true"].includes(normalized)) return "yes";
  if (["no", "nej", "false"].includes(normalized)) return "no";
  if (normalized.includes("implicit")) return "implicit";
  return "unknown";
}

function subscribeToSplitLayout(onChange: () => void) {
  const mediaQuery = window.matchMedia(CONTRACT_WORKBENCH_SPLIT_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSplitLayoutSnapshot() {
  return window.matchMedia(CONTRACT_WORKBENCH_SPLIT_QUERY).matches;
}

function getSplitLayoutServerSnapshot() {
  return false;
}

function queueFiltersFromReturnTo(returnTo: string) {
  const url = new URL(returnTo, "https://portal.invalid");
  const ownership = url.searchParams.get("ownership") ?? "all";
  return {
    search: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "all",
    type: url.searchParams.get("type") ?? "all",
    ownership: (["all", "missing", "proposed", "review", "conflict", "confirmed", "corrected"].includes(ownership) ? ownership : "all") as "all" | "missing" | "proposed" | "review" | "conflict" | "confirmed" | "corrected",
    rightsHolderId: url.searchParams.get("rh"),
    sortKey: (url.searchParams.get("sort") ?? "status") as "production" | "rightsHolder" | "employer" | "type" | "overenskomst" | "period" | "status",
    sortDir: url.searchParams.get("direction") === "desc" ? "desc" as const : "asc" as const,
  };
}

function blocksContractArrowNavigation(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [role='dialog'], [role='menu'], [role='listbox'], [role='tablist'], [data-pdf-viewer]")) return true;
  return ["BUTTON", "A"].includes(target.tagName);
}

export default function ContractWorkbenchClient({ data, returnTo, queueId: initialQueueId, initialSection }: { data: EditorData; returnTo: string; queueId: string | null; initialSection: string | null }) {
  const router = useRouter();
  const splitLayout = useSyncExternalStore(subscribeToSplitLayout, getSplitLayoutSnapshot, getSplitLayoutServerSnapshot);
  const contract = data.contract;
  const employer = relation<{ name: string }>(contract.employers);
  const holder = relation<{ full_name: string }>(contract.rettighedshavere);
  const linkedWork = relation<ContractWorkbenchData["works"][number]>(contract.works);
  const [form, setForm] = useState({
    type: contract.type ?? "a-løn",
    overenskomst: contract.overenskomst ?? "ingen",
    contractDate: contract.contract_date ?? "",
    startDate: contract.start_date ?? "",
    endDate: contract.end_date ?? "",
    workId: contract.work_id ?? "",
    workingTitle: contract.working_title ?? linkedWork?.title ?? "",
    seasonNumber: contract.season_number ?? parseSeasonNumberFromTitle(contract.working_title ?? linkedWork?.title ?? "") ?? 1,
    episodeNumbers: contract.episode_numbers?.length ? contract.episode_numbers : contractEpisodeNumbersFromLayout(data.layout),
  });
  const [producerSelections, setProducerSelections] = useState<ProductionCompanySelection[]>(data.producerSelections);
  const initialEditableSnapshotRef = useRef(JSON.stringify({
    form: {
      type: contract.type ?? "a-løn",
      overenskomst: contract.overenskomst ?? "ingen",
      contractDate: contract.contract_date ?? "",
      startDate: contract.start_date ?? "",
      endDate: contract.end_date ?? "",
      workId: contract.work_id ?? "",
      workingTitle: contract.working_title ?? linkedWork?.title ?? "",
      seasonNumber: contract.season_number ?? parseSeasonNumberFromTitle(contract.working_title ?? linkedWork?.title ?? "") ?? 1,
      episodeNumbers: contract.episode_numbers?.length ? contract.episode_numbers : contractEpisodeNumbersFromLayout(data.layout),
    },
    producerSelections: data.producerSelections,
  }));
  const [validationData, setValidationData] = useState<Record<string, unknown>>(contract.validation_data ?? {});
  const [variant, setVariant] = useState<ContractDocumentVariant>(data.documents.commented?.url ? "commented" : "original");
  const allowedInitialSection = SECTIONS.some(item => item.key === initialSection) && (initialSection !== "ownership" || data.canManageOwnership)
    ? initialSection!
    : "approve";
  const initialActiveField = useMemo(() => {
    if (allowedInitialSection === "ownership") {
      const nameQuote = data.sources?.rightsHolderName || contract.rettighedshavere?.full_name || "";
      const spatialEv = data.evidence?.rightsHolderName;
      if (nameQuote || spatialEv) {
        return {
          fieldKey: "ownership",
          label: "Navn aflæst fra kontrakten",
          sourceKey: "rightsHolderName",
          quote: nameQuote,
          focusText: nameQuote,
          page: spatialEv?.page ?? (data.sources?.rightsHolderName_page ? Number(data.sources.rightsHolderName_page) : 1),
          bbox: spatialEv?.bbox ?? null,
          coordinateSource: spatialEv?.coordinateSource ?? null,
          confidence: spatialEv?.confidence ?? null,
          highlight: nameQuote,
        };
      }
    }
    return null;
  }, [allowedInitialSection, data.sources, data.evidence, contract.rettighedshavere]);
  const [activeField, setActiveField] = useState<(ContractEvidenceActivation & { highlight: string }) | null>(initialActiveField);
  const [tab, setTab] = useState(allowedInitialSection);
  const [queueId, setQueueId] = useState(initialQueueId);
  const [queue, setQueue] = useState<AdminContractQueueContext | null>(null);
  const [queueLoading, setQueueLoading] = useState(Boolean(initialQueueId));
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [ownershipCommand, setOwnershipCommand] = useState(0);
  const implicitQueueRequestedRef = useRef(false);
  const [mobilePane, setMobilePane] = useState<"document" | "data">("data");
  const [mobileSourceView, setMobileSourceView] = useState<"closed" | "preview" | "document">("closed");
  const [saving, setSaving] = useState(false);
  const [aiReading, setAiReading] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectMessage, setRejectMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [soloConfirmed, setSoloConfirmed] = useState<boolean>(() => {
    return Boolean(
      (validationData as any).soloConfirmed ??
      (validationData as any).isSoloClipped
    );
  });
  const [validatedOpen, setValidatedOpen] = useState(false);
  const flushHandlersRef = useRef(new Map<string, () => Promise<boolean>>());
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([allowedInitialSection]));
  const [pdfResetToken, setPdfResetToken] = useState(0);
  const [documentReview, setDocumentReview] = useState<ContractDocumentReviewData | null>(null);
  const [documentReviewLoading, setDocumentReviewLoading] = useState(true);
  const [documentReviewAction, setDocumentReviewAction] = useState<ContractDocumentReviewAction | null>(null);
  const [documentReviewStatus, setDocumentReviewStatus] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>(contract.contract_comments ?? []);
  const markingCommentsReadRef = useRef(false);
  const [reply, setReply] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const splitContainerRef = useRef<HTMLElement | null>(null);
  const splitPercentRef = useRef(43);
  const [splitPercent, setSplitPercent] = useState(43);
  const [resizingSplit, setResizingSplit] = useState(false);

  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [workQuery, setWorkQuery] = useState(form.workingTitle);
  const [workResults, setWorkResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [workSearching, setWorkSearching] = useState(false);
  const [workSearched, setWorkSearched] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const [selectedWorkResult, setSelectedWorkResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [workTypeFilter, setWorkTypeFilter] = useState(() => contractWorkTypeFilter(typeof validationData.productionType === "string" ? validationData.productionType : null));
  const [manualWorkMode, setManualWorkMode] = useState(false);
  const extractedProducerNames = useMemo(() => extractedProductionCompanyNames(validationData), [validationData]);
  const [manualWork, setManualWork] = useState<ManualWorkFormValue>(() => ({
    ...emptyManualWorkForm(contractDataToManualWorkSeed({
    title: typeof validationData.workTitle === "string" ? validationData.workTitle : form.workingTitle,
    category: typeof validationData.productionType === "string" ? validationData.productionType : null,
    duration: typeof validationData.duration === "string" || typeof validationData.duration === "number" ? validationData.duration : null,
    premiereDate: typeof validationData.premiereDate === "string" ? validationData.premiereDate : null,
    premiereYear: typeof validationData.premiereYear === "string" || typeof validationData.premiereYear === "number" ? validationData.premiereYear : null,
    productionCompany: data.producerSelections[0]?.canonicalName ?? extractedProductionCompanyNames(validationData)[0] ?? null,
    director: typeof validationData.director === "string" ? validationData.director : null,
    seasonNumber: typeof validationData.seasonNumber === "string" || typeof validationData.seasonNumber === "number" ? validationData.seasonNumber : form.seasonNumber,
    episodes: form.episodeNumbers.map((number: number) => ({ number })),
      contractId: contract.id,
    })),
    production_companies: data.producerSelections,
  }));
  const [episodeOptions, setEpisodeOptions] = useState<SeriesEpisodeOption[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const seriesOptionsKey = useRef<string | null>(null);
  const editorInitialData = useMemo(() => ({ ...validationData, _sources: data.sources }), [data.sources, validationData]);

  useAdminPageTitle(form.workingTitle || linkedWork?.title || "Rediger kontrakt", "Rediger og valider kontrakt");

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= 25 && stored <= 70) {
      splitPercentRef.current = stored;
      setSplitPercent(stored);
    }
  }, []);

  const parentFieldsAreDirty = useCallback(() => initialEditableSnapshotRef.current !== JSON.stringify({ form, producerSelections }), [form, producerSelections]);

  const loadQueue = useCallback(async (id: string) => {
    setQueueLoading(true);
    const result = await fetchAdminContractWorkQueue(id, contract.id);
    if (result.success) setQueue(result.data);
    else {
      setQueue(null);
      setQueueId(null);
      toast.error(result.error);
    }
    setQueueLoading(false);
  }, [contract.id]);

  useEffect(() => {
    if (queueId) {
      void loadQueue(queueId);
      return;
    }
    if (implicitQueueRequestedRef.current) return;
    implicitQueueRequestedRef.current = true;
    const kind = initialSection === "ownership" && data.canManageOwnership ? "ownership" : "filtered";
    void createAdminContractWorkQueue({ kind, filters: queueFiltersFromReturnTo(returnTo) }).then(result => {
      if (!result.success) return;
      if (!result.queueId) return;
      setQueueId(result.queueId);
      void loadQueue(result.queueId);
    });
  }, [data.canManageOwnership, initialSection, loadQueue, queueId, returnTo]);

  useEffect(() => {
    if (splitLayout && mobileSourceView !== "closed") setMobileSourceView("closed");
  }, [mobileSourceView, splitLayout]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/contracts/${contract.id}/document-processing`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async response => {
      const body = await response.json().catch(() => ({})) as { data?: ContractDocumentReviewData | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "PDF-status kunne ikke hentes.");
      setDocumentReview(body.data ?? null);
    }).catch(error => {
      if (!controller.signal.aborted) setDocumentReviewStatus(error instanceof Error ? error.message : "PDF-status kunne ikke hentes.");
    }).finally(() => {
      if (!controller.signal.aborted) setDocumentReviewLoading(false);
    });
    return () => controller.abort();
  }, [contract.id]);

  async function handleDocumentReviewAction(action: ContractDocumentReviewAction) {
    if (documentReviewAction) return;
    setDocumentReviewAction(action);
    setDocumentReviewStatus(action === "retry" ? "Sætter PDF'en i kø…" : "Registrerer behovet for en ny scanning…");
    try {
      const response = await fetch(`/api/admin/contracts/${contract.id}/document-processing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({})) as { accepted?: boolean; error?: string };
      if (!response.ok || !body.accepted) throw new Error(body.error ?? "PDF-handlingen kunne ikke gennemføres.");
      const refreshed = await fetch(`/api/admin/contracts/${contract.id}/document-processing`, { cache: "no-store" });
      const refreshedBody = await refreshed.json().catch(() => ({})) as { data?: ContractDocumentReviewData | null };
      if (refreshed.ok) setDocumentReview(refreshedBody.data ?? null);
      setDocumentReviewStatus(action === "retry" ? "PDF'en er sat i kø til ny behandling." : "Behovet for en ny scanning er registreret.");
      toast.success(action === "retry" ? "PDF'en er sat i kø" : "Ny scanning er registreret");
    } catch (error) {
      setDocumentReviewStatus(error instanceof Error ? error.message : "PDF-handlingen kunne ikke gennemføres.");
    } finally {
      setDocumentReviewAction(null);
    }
  }

  const selectedDocument = data.documents[variant] ?? data.documents.commented ?? data.documents.original;
  const documentUrl = selectedDocument?.url ?? null;
  const documentIsPdf = Boolean(selectedDocument?.path.toLowerCase().split("?")[0].endsWith(".pdf"));
  const coordinatesMatchDocument = variant === "commented" || !data.documents.commented?.url;
  const documentLayout = coordinatesMatchDocument ? data.layout : null;
  const activeWork = data.works.find(work => work.id === form.workId) ?? linkedWork;
  const isSeries = (selectedWorkResult?.type ?? activeWork?.type ?? "").includes("serie");
  const displayedWorkTitle = selectedWorkResult?.title ?? activeWork?.title ?? "Intet værk tilknyttet";
  const displayedWorkLabel = isSeries && (form.workId || selectedWorkResult)
    ? `${displayedWorkTitle} · sæson ${form.seasonNumber}`
    : displayedWorkTitle;
  const localWorkSuggestion = useMemo(
    () => form.workId || selectedWorkResult || manualWorkMode ? null : suggestLocalContractWork(form.workingTitle, data.works),
    [data.works, form.workId, form.workingTitle, manualWorkMode, selectedWorkResult],
  );
  const missingByTab = useMemo<Record<string, ContractValidationMissingField[]>>(() => {
    const result: Record<string, ContractValidationMissingField[]> = Object.fromEntries(SECTIONS.map(section => [section.key, []]));
    const add = (tab: string, key: string, label: string) => result[tab].push({ key, label, tab });
    if (!contract.rights_holder_id) add("approve", "rightsHolder", "Rettighedshaver");
    if (!producerSelections.length) add("approve", "producer", "Producent");
    if (!form.workId && !selectedWorkResult && !manualWorkMode) add("approve", "work", "Tilknyttet værk");
    if (!form.type) add("approve", "contractType", "Kontrakttype");
    if (!form.overenskomst) add("approve", "agreement", "Overenskomst");
    if (triState(validationData.copydan) === "unknown") add("approve", "copydan", "Copydan-forbehold");
    if (!("hasCreditClause" in validationData)) add("approve", "credit", "Krediteringsklausul");
    if (!("royalty" in validationData)) add("approve", "royalty", "Royalty");
    if (triState(validationData.svod) === "unknown") add("approve", "svod", "Streaming-forbehold");
    if (!form.contractDate) add("approve", "contractDate", "Kontraktdato");
    if (validationData.salary == null) add("salary", "salary", "Ugeløn");
    if (isSeries && form.episodeNumbers.length === 0) {
      add("approve", "episodeNumbers", "Valgte serieafsnit");
      add("series", "episodeNumbers", "Valgte afsnit");
    }
    if (isSeries && !soloConfirmed) {
      add("approve", "collaboration", "Solo- eller medklipper-valg");
    }
    if (triState(validationData.signatureStatus) === "unknown") add("approve", "signatureStatus", "Underskrevet");
    if (triState(validationData.signatureStatus) === "yes" && !validationData.signatureDate) {
      add("approve", "signatureDate", "Underskriftsdato");
    }
    if (activeWork && !activeWork.dfi_id && !activeWork.tmdb_id && !activeWork.imdb_id) add("ids", "externalIds", "Eksternt værk-ID");
    if (!validationData.productionType && !validationData.director) add("work", "workDetails", "Produktionstype eller instruktør");
    return result;
  }, [activeWork, contract.rights_holder_id, form, isSeries, manualWorkMode, producerSelections.length, selectedWorkResult, soloConfirmed, validationData]);
  const missing = missingByTab.approve;
  const allMissing = useMemo(() => Object.values(missingByTab).flat(), [missingByTab]);
  const tabCounts = useMemo(() => Object.fromEntries(Object.entries(missingByTab).map(([key, items]) => [key, items.length])), [missingByTab]);
  const isValidationRecommended = useMemo(() => {
    const nonSignatureMissing = missing.filter(
      item => item.key !== "signatureStatus" && item.key !== "signatureDate"
    );
    return nonSignatureMissing.length === 0;
  }, [missing]);

  const setActive = (evidence: ContractEvidenceActivation) => {
    const coordinateEvidence = data.evidence?.[evidence.sourceKey] ?? data.evidence?.[evidence.fieldKey];
    if ((evidence.bbox || coordinateEvidence?.bbox) && data.documents.commented?.url) setVariant("commented");
    const highlight = evidence.quote
      ? CLAUSE_EVIDENCE_KEYS.has(evidence.sourceKey)
        ? evidence.quote
        : evidence.focusText?.trim() || evidence.quote
      : "";
    const next = { ...evidence, highlight };
    const hasFocusOrCoordinate = Boolean(evidence.bbox || coordinateEvidence?.bbox || evidence.focusText?.trim());
    if (!evidence.quote.trim() && !hasFocusOrCoordinate) {
      setActiveField(next);
      setPdfResetToken(current => current + 1);
      if (!splitLayout) {
        setMobileSourceView("closed");
        setMobilePane("document");
      }
      return;
    }
    if (!splitLayout) {
      setActiveField(next);
      setMobileSourceView("preview");
      return;
    }
    setActiveField(next);
  };
  const documentLastPage = useMemo(() => Math.max(1, ...(data.layout?.clauses ?? []).map(clause => Number(clause.page) || 1)), [data.layout]);
  const activateEvidence = (evidence: ContractEvidenceActivation) => {
    if (evidence.fieldKey === "signatureStatus" || evidence.fieldKey === "signatureDate") {
      const targetPage = evidence.page ?? documentLastPage;
      const signatureClause = data.layout?.clauses?.find(c =>
        (c.page ?? 1) >= Math.max(1, documentLastPage - 1) &&
        /(for\s+producenten|for\s+(?:lønmodtageren|medarbejderen|klipperen)|penneo|docusign|adobe\s*sign|digitalt\s+signeret|dato\s*[,:]\s*sted|sted\s*[,:]\s*dato|dato\s+og\s+underskrift|_{3,})/i.test(c.text)
      );
      const clauseBbox: ContractEvidenceBbox | null = signatureClause?.pdfBbox?.x != null && signatureClause.pdfBbox.y != null && signatureClause.pdfBbox.width != null && signatureClause.pdfBbox.height != null
        ? { x: signatureClause.pdfBbox.x, y: signatureClause.pdfBbox.y, width: signatureClause.pdfBbox.width, height: signatureClause.pdfBbox.height, space: "pdf_bottom_left" }
        : null;
      return setActive({
        ...evidence,
        page: targetPage,
        clauseId: evidence.clauseId ?? signatureClause?.id ?? null,
        bbox: evidence.bbox ?? clauseBbox,
        focusText: null, // Undgå tekstsøgning på det isolerede ord "underskrift"
        quote: signatureClause?.text ?? "",
      });
    }
    return setActive(evidence);
  };
  const activeEvidenceBase = activeField ? fieldEvidence(activeField.fieldKey, activeField.sourceKey, {
    ...data.sources,
    [activeField.sourceKey]: activeField.quote,
    [`${activeField.sourceKey}_clause_id`]: activeField.clauseId ?? data.sources[`${activeField.sourceKey}_clause_id`] ?? null,
    [`${activeField.sourceKey}_page`]: activeField.page == null ? data.sources[`${activeField.sourceKey}_page`] ?? null : String(activeField.page),
  }, data.layout, data.evidence) : null;
  const activeEvidence: ContractFieldEvidence | null = activeEvidenceBase
    ? { ...activeEvidenceBase, bbox: activeField?.bbox ?? activeEvidenceBase.bbox, coordinateSource: activeField?.coordinateSource ?? activeEvidenceBase.coordinateSource, confidence: activeField?.confidence ?? activeEvidenceBase.confidence, page: activeField?.page ?? activeEvidenceBase.page, focusText: activeField?.focusText?.trim() || activeField?.highlight || null }
    : null;

  const baseRow = (args: { key: string; label: string; sourceKey: string; source: ContractFieldSource; focusText?: string | null; missing?: boolean; children: React.ReactNode }) => {
    const evidence = fieldEvidence(args.key, args.sourceKey, data.sources, data.layout, data.evidence);
    const activation: ContractEvidenceActivation = {
      fieldKey: args.key,
      label: args.label,
      sourceKey: args.sourceKey,
      quote: evidence.quote ?? "",
      focusText: args.focusText,
      clauseId: evidence.clauseId,
      page: evidence.clause?.page ?? evidence.page,
      bbox: evidence.bbox,
      coordinateSource: evidence.coordinateSource,
      confidence: evidence.confidence,
    };
    const activateFromRow = (event: MouseEvent) => {
      if ((event.target as Element).closest("button,input,select,textarea,a,[role='combobox']")) return;
      activateEvidence(activation);
    };
    return <div id={`field-${args.key}`} data-review-row tabIndex={0} onKeyDown={event => {
      if (event.key === "Escape" && event.target !== event.currentTarget) { event.preventDefault(); event.currentTarget.focus(); return; }
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter") { event.preventDefault(); activateEvidence(activation); return; }
      if (event.key === "F2") { event.preventDefault(); const control = event.currentTarget.querySelector<HTMLElement>("input,button,select,textarea,[role='combobox']"); control?.focus(); return; }
      if (event.key === "Tab") {
        const rows = [...event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-review-row]") ?? []];
        const index = rows.indexOf(event.currentTarget);
        const next = rows[index + (event.shiftKey ? -1 : 1)];
        if (next) { event.preventDefault(); next.focus(); }
      }
    }} onClick={activateFromRow} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring last:border-b-0 ${activeField?.fieldKey === args.key ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500 dark:bg-amber-950/40 dark:ring-amber-500" : ""} ${args.missing ? "bg-rose-500/10 border-l-2 border-l-rose-500 dark:bg-rose-950/20" : ""}`}>
      <div className="flex min-w-0 items-center gap-1.5"><Label className="truncate text-[11px] font-medium text-foreground">{args.label}</Label>{args.missing && <Badge className="h-3.5 rounded-sm bg-rose-600 px-1 text-[7.5px] font-semibold text-white dark:bg-rose-700">Mangler</Badge>}</div>
      <div className="min-w-0 relative">{args.children}</div>
      <div className="flex items-center justify-end gap-1 shrink-0">
        <button type="button" onClick={() => activateEvidence(activation)} title="Se kilde i PDF">
          <ContractSourceBadge source={args.source} />
        </button>
      </div>
    </div>;
  };

  async function runAiReading() {
    setAiReading(true);
    try {
      const queued = await queueAdminContractAiExtraction(contract.id);
      if (!queued.success || !queued.jobId) throw new Error(queued.error ?? "AI-aflæsningen kunne ikke startes");
      const response = await fetch("/api/contracts/jobs/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: queued.jobId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "AI-aflæsningen fejlede");
      toast.success("AI-aflæsningen er gennemført");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI-aflæsningen fejlede");
      setAiReading(false);
    }
  }

  async function searchWorks(queryOverride?: string) {
    const query = (queryOverride ?? workQuery).trim();
    if (!query) return;
    setWorkSearching(true); setWorkError(null); setWorkSearched(true);
    try {
      const result = await searchWorksUnified(query);
      if (!result.success) throw new Error("Søgningen kunne ikke gennemføres");
      setWorkResults(result.results);
    } catch (error) {
      setWorkError(error instanceof Error ? error.message : "Søgningen fejlede");
    } finally { setWorkSearching(false); }
  }

  function openWorkSearch() {
    const query = (workQuery || form.workingTitle).trim();
    setWorkPickerOpen(true);
    setManualWorkMode(false);
    if (query) {
      setWorkQuery(query);
      void searchWorks(query);
    }
  }

  function setManualMode(manual: boolean) {
    if (manual) {
      setManualWork(current => ({
        ...current,
        production_company: current.production_company || producerSelections[0]?.canonicalName || "",
        production_companies: current.production_companies.length ? current.production_companies : producerSelections,
      }));
    }
    setManualWorkMode(manual);
  }

  async function chooseWork(result: UnifiedSearchWorkResult) {
    const selectedSeason = parseSeasonNumberFromTitle(form.workingTitle) ?? parseSeasonNumberFromTitle(result.title) ?? form.seasonNumber;
    setSelectedWorkResult(result);
    setForm(current => ({
      ...current,
      workId: result.local_id ?? "",
      workingTitle: current.workingTitle || result.title,
      seasonNumber: result.type.includes("serie") ? selectedSeason : current.seasonNumber,
    }));
    setWorkQuery(result.title);
    if (result.type.includes("serie")) {
      const details = await resolveUnifiedSearchResultDetails(result, selectedSeason);
      const detailData = details && "details" in details ? details.details as any : null;
      setEpisodeOptions(buildCompleteEpisodeOptions({ episodeCount: detailData?.episode_count ?? null, externalOptions: detailData?.episode_options ?? [], seasonNumber: selectedSeason }));
    }
  }

  async function loadSeriesEpisodeOptions() {
    if (!activeWork || !isSeries) return;
    const key = `${activeWork.id}:${form.seasonNumber}`;
    if (seriesOptionsKey.current === key) return;
    seriesOptionsKey.current = key;
    setEpisodesLoading(true);
    setEpisodesError(null);
    try {
      const result = await getAdminContractSeriesEpisodeOptions({ contractId: contract.id, seasonNumber: form.seasonNumber });
      if (result.success && result.options.length > 0) {
        setEpisodeOptions(current => mergeEpisodeOptionsByPriority(current, result.options));
        setForm(current => current.episodeNumbers.length > 0 || result.selectedEpisodes.length === 0
          ? current
          : { ...current, episodeNumbers: result.selectedEpisodes });
      } else {
        setEpisodesError(result.error ?? `Sæson ${form.seasonNumber} blev ikke fundet.`);
      }
    } catch (error) {
      seriesOptionsKey.current = null;
      setEpisodesError(error instanceof Error ? error.message : "Afsnittene kunne ikke hentes.");
    } finally {
      setEpisodesLoading(false);
    }
  }

  async function resolveWorkBeforeSave() {
    if (manualWorkMode) {
      const error = validateManualWork(manualWork, "da");
      if (error) throw new Error(error);
      const numberOrNull = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
      const result = await createAdminWork({
        data: {
          title: manualWork.title.trim(), type: manualWork.type, year: numberOrNull(manualWork.year), duration_minutes: numberOrNull(manualWork.duration_minutes),
          season_count: null, episode_count: numberOrNull(manualWork.episode_count), parent_work_id: null, season_number: numberOrNull(manualWork.season_number), episode_number: numberOrNull(manualWork.episode_number),
          genre: null, director: manualWork.director.trim() || null, alternative_titles: [], production_countries: [], production_companies: manualWork.production_companies.map(item => item.canonicalName), description: null, dfi_id: null, tmdb_id: null, poster_url: null,
        },
        seasonNumber: numberOrNull(manualWork.season_number), selectedEpisodes: manualWork.selected_episodes, productionCompanies: manualWork.production_companies, status: "godkendt",
      });
      return result.workId;
    }
    if (selectedWorkResult && !selectedWorkResult.local_id) {
      const result = await createAndLinkWorkForContract({ contractId: contract.id, result: selectedWorkResult, seasonNumber: form.seasonNumber, selectedEpisodes: form.episodeNumbers, rightsHolderId: contract.rights_holder_id, role: "Klipper" });
      if (!result.success || !result.workId) throw new Error(result.error ?? "Værket kunne ikke tilknyttes");
      return result.workId;
    }
    return (selectedWorkResult?.local_id ?? form.workId) || null;
  }

  async function save(status?: "kladde" | "valideret" | "arkiveret", showValidatedDialog = true) {
    setSaving(true);
    try {
      for (const flush of flushHandlersRef.current.values()) {
        if (!(await flush())) throw new Error("De udtrukne data kunne ikke gemmes");
      }
      const workId = await resolveWorkBeforeSave();
      const result = await updateAdminContract(contract.id, {
        type: form.type,
        overenskomst: form.overenskomst === "ingen" ? null : form.overenskomst,
        status: status ?? (contract.status === "valideret" ? "valideret" : "kladde"),
        contract_date: form.contractDate || null,
        start_date: form.startDate || null,
        end_date: form.endDate || null,
        employer_id: producerSelections[0]?.employerId ?? null,
        producer_selections: producerSelections,
        work_id: workId,
        working_title: form.workingTitle || null,
        season_number: isSeries ? form.seasonNumber : null,
        episode_numbers: isSeries ? form.episodeNumbers : null,
      });
      if (!result.success) throw new Error(result.error);
      setForm(current => ({ ...current, workId: workId ?? "" }));
      initialEditableSnapshotRef.current = JSON.stringify({ form: { ...form, workId: workId ?? "" }, producerSelections });
      if (status === "valideret" && showValidatedDialog) setValidatedOpen(true);
      else toast.success(status === "arkiveret" ? "Kontrakten er afvist" : "Kontrakten er gemt");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke gemmes");
      return false;
    } finally { setSaving(false); }
  }

  const [validateAndNextRequested, setValidateAndNextRequested] = useState(false);

  async function completeValidation(goNext: boolean) {
    const isSigned = triState(validationData.signatureStatus) === "yes";
    // Vis ikke bekræftelses-popup ved validering - brugeren skal have en hurtig, flydende arbejdsgang
    const success = await save("valideret", false);
    if (!success) return;
    if (!isSigned) {
      toast.info("Kontrakten er valideret uden underskrift", { duration: 2500 });
    } else {
      toast.success("Kontrakten er valideret", { duration: 2500 });
    }
    if (queueId) await markAdminContractQueueItem(queueId, contract.id, "completed");
    if (goNext) {
      // Lad den midlertidige besked vise sig kort før næste side loades
      await new Promise(resolve => setTimeout(resolve, 600));
      if (queue?.nextContractId) {
        navigateTo(queue.nextContractId);
      } else {
        router.push(safeContractReturnTo(returnTo));
      }
    }
  }

  async function validate(goNext = false) {
    // Underskrift og underskriftsdato må aldrig blokere eller udløse bekræftelses-popup.
    // Kun kritiske felter (valgte afsnit på serie, solo/medklipper, manglende værk, rettighedshaver, kontrakttype, producent) må blokere:
    const CRITICAL_KEYS = new Set(["episodeNumbers", "collaboration", "work", "rightsHolder", "contractType", "producer"]);
    const blockingMissing = allMissing.filter(item => CRITICAL_KEYS.has(item.key));
    if (blockingMissing.length) {
      setValidateAndNextRequested(goNext);
      setValidateOpen(true);
      return;
    }
    await completeValidation(goNext);
  }

  function changeTab(nextTab: string) {
    if (nextTab === "ownership" && !data.canManageOwnership) nextTab = "approve";
    if (nextTab === tab) return;
    setVisitedTabs(current => new Set(current).add(nextTab));
    setTab(nextTab);
    if (nextTab === "ownership") {
      const nameQuote = data.sources?.rightsHolderName || contract.rettighedshavere?.full_name || "";
      const spatialEv = data.evidence?.rightsHolderName;
      if (nameQuote || spatialEv) {
        setActive({
          fieldKey: "ownership",
          label: "Navn aflæst fra kontrakten",
          sourceKey: "rightsHolderName",
          quote: nameQuote,
          focusText: nameQuote,
          page: spatialEv?.page ?? (data.sources?.rightsHolderName_page ? Number(data.sources.rightsHolderName_page) : 1),
          bbox: spatialEv?.bbox ?? null,
          coordinateSource: spatialEv?.coordinateSource ?? null,
          confidence: spatialEv?.confidence ?? null,
        });
      }
    }
    const next = new URLSearchParams(window.location.search);
    next.set("section", nextTab);
    router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (tab !== "messages") return;
    const unread = comments.some(comment => comment.author_role === "member" && !comment.admin_read_at);
    if (!unread || markingCommentsReadRef.current) return;
    markingCommentsReadRef.current = true;
    const readAt = new Date().toISOString();
    void markContractCommentsRead(contract.id, "admin").then(async result => {
      if (!result.success) return toast.error(result.error);
      if (queueId) await markAdminContractQueueItem(queueId, contract.id, "completed");
      setComments(current => current.map(comment => comment.author_role === "member" && !comment.admin_read_at ? { ...comment, admin_read_at: readAt } : comment));
      window.dispatchEvent(new Event("contracts-updated"));
    }).finally(() => { markingCommentsReadRef.current = false; });
  }, [comments, contract.id, queueId, tab]);

  async function sendReply() {
    const text = reply.trim();
    if (!text || replySaving) return;
    setReplySaving(true);
    const result = await addAdminContractComment(contract.id, text);
    if (result.success && result.comment) {
      setComments(current => [...current, result.comment]);
      setReply("");
      toast.success("Beskeden er sendt");
    } else toast.error(result.error ?? "Beskeden kunne ikke sendes");
    setReplySaving(false);
  }

  useEffect(() => {
    // Ingen automatisk kildeaktivering eller fokus ved sideindlæsning.
    // Kontrakten skal åbnes i neutral full-size visning uden forudvalgt kilde.
  }, [contract.id, tab]);

  async function reject() {
    if (rejectMessage.trim()) {
      const message = await addAdminContractComment(contract.id, rejectMessage);
      if (!message.success) { toast.error(message.error); return; }
    }
    if (await save("arkiveret")) {
      setRejectOpen(false);
      router.push(safeContractReturnTo(returnTo));
    }
  }

  async function handleDeleteContract() {
    setDeleting(true);
    try {
      const result = await deleteAdminContractsPermanently([contract.id]);
      if (!result.success) {
        toast.error(result.error ?? "Kontrakten kunne ikke slettes");
        return;
      }
      toast.success("Kontrakten er slettet permanent");
      setDeleteOpen(false);
      if (queue?.nextContractId) {
        navigateTo(queue.nextContractId);
      } else {
        router.push(safeContractReturnTo(returnTo));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke slettes");
    } finally {
      setDeleting(false);
    }
  }

  async function saveAndNext() {
    const success = await save();
    if (!success) return;
    toast.success("Kontrakten er gemt", { duration: 2000 });
    if (queue?.nextContractId) {
      navigateTo(queue.nextContractId);
    } else {
      router.push(safeContractReturnTo(returnTo));
    }
  }

  function contractEditorUrl(nextContractId: string) {
    const section = queue?.kind === "ownership" && data.canManageOwnership ? "ownership" : tab;
    const params = new URLSearchParams({ returnTo, section });
    if (queueId) params.set("queueId", queueId);
    return `/admin/kontrakter/${nextContractId}/rediger?${params.toString()}`;
  }

  function navigateTo(nextContractId: string | null) {
    if (!nextContractId) {
      toast.info("Du er nået til slutningen af listen");
      return;
    }
    router.push(contractEditorUrl(nextContractId));
  }

  function requestNavigate(nextContractId: string | null) {
    if (!nextContractId) return navigateTo(null);
    if (parentFieldsAreDirty()) {
      setPendingNavigation(nextContractId);
      return;
    }
    navigateTo(nextContractId);
  }

  async function openNext() {
    requestNavigate(queue?.nextContractId ?? null);
  }

  async function handleOwnershipCompleted(goNext: boolean) {
    if (queueId) await markAdminContractQueueItem(queueId, contract.id, "completed");
    if (goNext) navigateTo(queue?.nextContractId ?? null);
    else router.refresh();
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if ((event.target as HTMLElement | null)?.closest("[role='dialog']")) return;
        event.preventDefault();
        if (tab === "ownership") setOwnershipCommand(value => value + 1);
        else if (tab === "approve" && queue?.nextContractId) void validate(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || blocksContractArrowNavigation(event.target)) return;
      if (event.key === "ArrowLeft" && queue?.previousContractId) {
        event.preventDefault();
        requestNavigate(queue.previousContractId);
      } else if (event.key === "ArrowRight" && queue?.nextContractId) {
        event.preventDefault();
        requestNavigate(queue.nextContractId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // Functions use the current editor state and queue snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, tab, queueId, parentFieldsAreDirty]);

  const renderEditor = (cacheKey: string, section: ContractValidationSectionKey, includeFieldKeys?: string[], excludeFieldKeys?: string[]) => (
    <ContractAiDataEditor
      contractId={contract.id}
      section={section}
      bare
      includeFieldKeys={includeFieldKeys}
      excludeFieldKeys={excludeFieldKeys}
      requiredFieldKeys={includeFieldKeys}
      activeHighlight={activeField?.highlight ?? null}
      onHighlightClick={quote => {
        const sourceKey = Object.entries(data.sources).find(([, value]) => value === quote)?.[0]?.replace(/_(?:clause_id|page)$/, "") ?? section;
        setActive({ fieldKey: sourceKey, sourceKey, quote, clauseId: data.sources[`${sourceKey}_clause_id`] ?? null, page: data.sources[`${sourceKey}_page`] && Number.isFinite(Number(data.sources[`${sourceKey}_page`])) ? Number(data.sources[`${sourceKey}_page`]) : null });
      }}
      onEvidenceActivate={activateEvidence}
      activeEvidenceFieldKey={activeField?.fieldKey ?? null}
      initialData={editorInitialData}
      dates={{ contractDate: form.contractDate, startDate: form.startDate, endDate: form.endDate }}
      onDatesChange={dates => setForm(current => ({ ...current, contractDate: dates.contractDate, startDate: dates.startDate, endDate: dates.endDate }))}
      isSeries={isSeries}
      season={form.seasonNumber}
      onSeasonChange={seasonNumber => setForm(current => ({ ...current, seasonNumber, episodeNumbers: [] }))}
      episodeOptions={episodeOptions}
      episodesLoading={episodesLoading}
      episodesError={episodesError}
      onSeriesOpen={() => void loadSeriesEpisodeOptions()}
      selectedEpisodes={form.episodeNumbers}
      onSelectedEpisodesChange={episodeNumbers => setForm(current => ({ ...current, episodeNumbers }))}
      onSeriesDataLoaded={(options, selectedEpisodes) => {
        if (options.length > 0) {
          setEpisodeOptions(current => mergeEpisodeOptionsByPriority(current, options));
        }
        setForm(current => current.episodeNumbers.length > 0 || selectedEpisodes.length === 0
          ? current
          : { ...current, episodeNumbers: selectedEpisodes });
      }}
      workingTitle={form.workingTitle}
      onWorkingTitleChange={workingTitle => setForm(current => ({ ...current, workingTitle }))}
      onValidationChange={patch => setValidationData(current => ({ ...current, ...patch }))}
      registerFlush={handler => {
        if (handler) flushHandlersRef.current.set(cacheKey, handler);
        else flushHandlersRef.current.delete(cacheKey);
      }}
    />
  );

  const previewDocument = activeEvidence?.bbox && data.documents.commented?.url
    ? data.documents.commented
    : activeEvidence?.clause?.pdfBbox && data.documents.commented?.url
    ? data.documents.commented
    : selectedDocument;
  const previewIsPdf = Boolean(previewDocument?.path.toLowerCase().split("?")[0].endsWith(".pdf"));
  const openEvidenceDocument = () => {
    if (!activeField?.quote || !documentUrl) return;
    if ((activeEvidence?.coordinateSource === "spatial_v3" || activeEvidence?.clause?.pdfBbox) && data.documents.commented?.url) setVariant("commented");
    setMobileSourceView("document");
  };
  const renderMissingSummary = (tabKey: string) => {
    const items = missingByTab[tabKey] ?? [];
    if (!items.length) return null;
    return <div className="m-2 rounded-sm border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100">
      <span className="font-medium text-rose-900 dark:text-rose-200">Mangler:</span> {items.map(item => item.label).join(" · ")}
    </div>;
  };

  return <div className={`-mx-3 -my-3 flex min-h-[calc(100svh-4rem)] flex-col bg-background sm:-mx-4 sm:-my-4 ${splitLayout ? "h-[calc(100svh-4rem)] min-h-0 overflow-hidden sm:-mx-6 sm:-my-6" : ""}`}>
    <header className="sticky top-0 z-30 border-b bg-background/95 px-2 py-1.5 backdrop-blur sm:px-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => router.push(safeContractReturnTo(returnTo))}><ArrowLeft className="h-3.5 w-3.5" />Tilbage</Button>
        <div className="hidden min-w-0 flex-1 md:block"><p className="truncate text-xs font-semibold">{form.workingTitle || linkedWork?.title || "Kontrakt"}</p><p className="truncate text-[10px] text-muted-foreground">{producerSelections[0]?.canonicalName ?? employer?.name ?? "Ingen producent"} · {holder?.full_name ?? "Ingen rettighedshaver"}</p></div>
        <Badge variant="outline" className="h-6 shrink-0 rounded-sm px-1.5 text-[10px]">{contract.status === "valideret" ? "Valideret" : contract.status === "arkiveret" ? "Afvist" : "Afventer validering"}</Badge>
        {queue?.kind === "ownership" && <span className="shrink-0 text-[11px] font-semibold text-amber-800 dark:text-amber-200">Ejerskab afklaring</span>}
        {queue?.kind === "validation" && <span className="shrink-0 text-[11px] font-semibold text-amber-800 dark:text-amber-200">Valideringsafklaring</span>}
        <div className="flex h-8 shrink-0 items-center rounded-sm border bg-background" aria-label={queue?.kind === "ownership" ? "Ejerskab afklaring" : queue?.kind === "validation" ? "Valideringsafklaring" : "Listenavigation"}>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={queueLoading || !queue?.previousContractId} onClick={() => requestNavigate(queue?.previousContractId ?? null)} aria-label="Forrige kontrakt"><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" className="h-7 min-w-14 px-1.5 text-[10px]" disabled={queueLoading || !queue} onClick={() => setQueueSheetOpen(true)} aria-label="Vis kontrakter på listen">{queueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : queue ? `${queue.position} / ${queue.total}` : "– / –"}</Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={queueLoading || !queue?.nextContractId} onClick={() => requestNavigate(queue?.nextContractId ?? null)} aria-label="Næste kontrakt"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex shrink-0 rounded-sm border bg-muted/30 p-0.5">
          <Button size="sm" className={`h-7 shrink-0 gap-1.5 rounded-sm px-2 text-xs ${variant === "original" ? "bg-background font-medium text-foreground shadow-xs" : ""}`} variant={variant === "original" ? "secondary" : "ghost"} disabled={!data.documents.original?.url} onClick={() => setVariant("original")}>
            {variant === "original" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
            {data.documents.original?.convertedForViewing ? "Original konverteret PDF" : "Original"}
          </Button>
          <Button size="sm" className={`h-7 shrink-0 gap-1.5 rounded-sm px-2 text-xs ${variant === "commented" ? "bg-background font-medium text-foreground shadow-xs" : ""}`} variant={variant === "commented" ? "secondary" : "ghost"} disabled={!data.documents.commented?.url} onClick={() => setVariant("commented")}>
            {variant === "commented" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
            Konverteret PDF
          </Button>
        </div>
        {data.documents.original?.sourceUrl && <Button asChild size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Download uændret original"><a href={data.documents.original.sourceUrl} download><Download className="h-3.5 w-3.5" /><span className="sr-only">Download uændret original</span></a></Button>}
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving || aiReading} onClick={() => void runAiReading()}>{aiReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}AI-aflæsning</Button>
        <Button size="sm" variant="destructive" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving || deleting} onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" />Slet kontrakt</Button>
      </div>
      {data.documents.original?.convertedForViewing && variant === "original" && <p className="mt-1 text-[10px] text-muted-foreground">Original konverteret PDF vises som en neutral visningskopi af Word-filen. Download-knappen henter den uændrede original.</p>}
      {!splitLayout && <div className="mt-1 flex gap-1"><Button size="sm" className="h-7 text-xs" variant={mobilePane === "document" ? "default" : "outline"} onClick={() => setMobilePane("document")}>Dokument</Button><Button size="sm" className="h-7 text-xs" variant={mobilePane === "data" ? "default" : "outline"} onClick={() => setMobilePane("data")}>Kilder og data</Button></div>}
    </header>

    <main
      ref={splitContainerRef}
      className={`grid min-h-0 flex-1 ${resizingSplit ? "select-none" : ""}`}
      style={splitLayout ? { gridTemplateColumns: `minmax(260px, ${splitPercent}fr) 8px minmax(420px, ${100 - splitPercent}fr)` } : undefined}
    >
      <section data-testid="contract-document-pane" className={`${splitLayout || mobilePane === "document" ? "flex flex-col" : "hidden"} min-w-0 overflow-y-auto border-r ${splitLayout ? "min-h-0" : "min-h-[70svh]"}`}>
        <DocumentProcessingReviewCard review={documentReview} loading={documentReviewLoading} activeAction={documentReviewAction} statusMessage={documentReviewStatus} onAction={action => void handleDocumentReviewAction(action)} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {documentUrl ? documentIsPdf ? <PdfViewer key={`${contract.id}-${documentUrl}`} url={documentUrl} activeHighlight={activeField?.highlight ?? null} pageNavigationHint={activeField?.highlight ?? activeField?.quote ?? undefined} activePage={contractEvidencePage(activeEvidence)} layout={documentLayout} activeClauseId={documentLayout ? activeEvidence?.clauseId ?? null : null} activeEvidence={activeEvidence} resetViewToken={pdfResetToken} /> : <ContractDocViewer url={documentUrl} filename={selectedDocument?.path} activeHighlight={activeField?.highlight ?? null} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen dokumentfil</div>}
        </div>
      </section>

      {splitLayout ? <div
        role="separator"
        aria-label="Tilpas bredden mellem kontrakt og arbejdsområde"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={70}
        aria-valuenow={Math.round(splitPercent)}
        tabIndex={0}
        className="group relative z-30 flex cursor-col-resize touch-none items-center justify-center border-x bg-muted/30 outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setResizingSplit(true); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !splitContainerRef.current) return;
          const bounds = splitContainerRef.current.getBoundingClientRect();
          const next = Math.min(70, Math.max(25, ((event.clientX - bounds.left) / bounds.width) * 100));
          splitPercentRef.current = next;
          setSplitPercent(next);
        }}
        onPointerUp={event => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setResizingSplit(false);
          window.localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPercentRef.current));
        }}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setSplitPercent(current => {
            const next = Math.min(70, Math.max(25, current + (event.key === "ArrowLeft" ? -2 : 2)));
            splitPercentRef.current = next;
            window.localStorage.setItem(SPLIT_STORAGE_KEY, String(next));
            return next;
          });
        }}
      ><GripVertical className="h-5 w-5 text-muted-foreground group-hover:text-foreground" /></div> : null}

      <section data-testid="contract-data-pane" className={`${splitLayout || mobilePane === "data" ? "block" : "hidden"} relative z-10 min-h-0 min-w-0 bg-background ${splitLayout ? "overflow-y-auto" : ""}`}>
        <div className="hidden flex-wrap items-center gap-1 border-b bg-muted/20 px-3 py-1 min-[1440px]:flex"><span className="mr-1 text-[10px] font-medium">Datakilde:</span>{(["contract", "agreement", "member", "work_archive", "dfi", "tmdb", "wikidata", "manual", "stored"] as ContractFieldSource[]).map(source => <ContractSourceBadge key={source} source={source} />)}</div>
        <Tabs value={tab} onValueChange={changeTab} className="min-h-0 gap-0">
          <TabsList variant="line" className="sticky top-0 z-20 h-8 w-full justify-start overflow-x-auto rounded-none border-b bg-background px-2 py-0.5">
            {SECTIONS.filter(item => item.key !== "ownership" || data.canManageOwnership).map(item => <TabsTrigger key={item.key} value={item.key} className="h-7 flex-none px-2.5 py-1 text-xs font-medium">{item.label}{tabCounts[item.key] > 0 ? <Badge className="ml-1 h-3.5 min-w-3.5 rounded-sm bg-rose-600 px-1 text-[8px] font-semibold leading-none text-white dark:bg-rose-700">{tabCounts[item.key]}</Badge> : item.key !== "messages" ? <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Alle felter bekræftet" /> : null}</TabsTrigger>)}
          </TabsList>

          <TabsContent forceMount value="approve" className="m-0 data-[state=inactive]:hidden">
            {missing.length > 0 && <div className="m-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100"><span className="font-medium text-rose-900 dark:text-rose-200">{missing.length} mangler:</span> {missing.map(item => item.label).join(" · ")}</div>}
            <div className="divide-y divide-border/40">
              {baseRow({ key: "rightsHolder", label: "Rettighedshaver", sourceKey: "rightsHolderName", focusText: holder?.full_name ?? null, source: "unknown", missing: !contract.rights_holder_id, children: <div className="flex h-6 min-h-6 items-center rounded border bg-muted/30 px-2 text-[11px] font-medium"><span className="truncate flex-1">{holder?.full_name ?? "Ingen rettighedshaver tilknyttet"}</span>{data.canManageOwnership ? <button type="button" className="ml-1 shrink-0 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => changeTab("ownership")}>Åbn Ejerskab</button> : null}</div> })}
              {baseRow({ key: "producer", label: "Producent", sourceKey: "employerName", focusText: producerSelections[0]?.canonicalName ?? (extractedProducerNames[0] || employer?.name || null), source: producerSelections.length ? (producerSelections[0]?.employerId === contract.employer_id ? "contract" : "manual") : data.sources.employerName ? "contract" : "unknown", missing: !producerSelections.length, children: <ProductionCompanyPicker value={producerSelections} onChange={setProducerSelections} suggestedNames={extractedProducerNames} canManageRegistry hideLabel compact /> })}
              {baseRow({ key: "work", label: "Tilknyttet værk", sourceKey: "workTitle", focusText: form.workingTitle || displayedWorkTitle, source: form.workId ? "work_archive" : data.sources.workTitle ? "contract" : "manual", missing: !form.workId && !selectedWorkResult && !manualWorkMode, children: <div className="space-y-1"><div className="flex h-6 min-h-6 items-center gap-1 rounded border px-2 text-[11px]"><span className="min-w-0 flex-1 truncate">{form.workId || selectedWorkResult ? displayedWorkLabel : `Arbejdstitel: ${form.workingTitle || "Ingen"}`}</span>{form.workId || selectedWorkResult ? <><Button size="sm" variant="ghost" className="h-5 shrink-0 px-1.5 text-[10px]" onClick={() => setWorkPickerOpen(open => !open)}>{workPickerOpen ? "Luk" : "Skift"}</Button><button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fjern tilknyttet værk" onClick={() => { setForm(current => ({ ...current, workId: "" })); setSelectedWorkResult(null); setManualWorkMode(false); }}><X className="h-3 w-3" /></button></> : <Button size="sm" variant="ghost" className="h-5 shrink-0 px-1.5 text-[10px]" onClick={workPickerOpen ? () => setWorkPickerOpen(false) : openWorkSearch}>{workPickerOpen ? "Luk" : "Søg værk"}</Button>}</div>{localWorkSuggestion && !workPickerOpen && <button type="button" className="flex w-full items-center justify-between rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-left text-[10px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" onClick={() => { setForm(current => ({ ...current, workId: localWorkSuggestion.id, seasonNumber: parseSeasonNumberFromTitle(current.workingTitle) ?? current.seasonNumber })); setWorkQuery(localWorkSuggestion.title); }}><span className="truncate">Foreslået: {localWorkSuggestion.title}{parseSeasonNumberFromTitle(form.workingTitle) ? ` · sæson ${parseSeasonNumberFromTitle(form.workingTitle)}` : ""}</span><span className="ml-2 shrink-0 font-medium">Tilknyt</span></button>}{workPickerOpen && <WorkSelectionPanel query={workQuery} onQueryChange={setWorkQuery} onSearch={() => void searchWorks()} isSearching={workSearching} hasSearched={workSearched} searchError={workError} results={workResults} selectedId={selectedWorkResult?.id} onSelect={result => void chooseWork(result)} typeFilter={workTypeFilter} onTypeFilterChange={setWorkTypeFilter} manualMode={manualWorkMode} onManualModeChange={setManualMode} manualWork={manualWork} onManualWorkChange={setManualWork} locale="da" autoSelectManualProducer />}</div> })}
              {isSeries && baseRow({
                key: "series",
                label: "Serie og afsnit",
                sourceKey: "workTitle",
                source: form.episodeNumbers.length ? "contract" : "unknown",
                missing: form.episodeNumbers.length === 0 || !soloConfirmed,
                children: (
                  <div className="flex h-6 min-h-6 items-center justify-between gap-1.5 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="shrink-0 font-medium">Sæson {form.seasonNumber}</span>
                      <span className="text-muted-foreground">·</span>
                      {form.episodeNumbers.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => changeTab("series")}
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-rose-300/80 bg-rose-100/90 px-1.5 text-[9.5px] font-medium text-rose-800 shadow-none transition-colors hover:bg-rose-200/90 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                          title="Afsnit mangler – tryk for at åbne Afsnit og medklippere"
                        >
                          <Tv className="h-3 w-3 shrink-0" aria-hidden />
                          <span>Afsnit mangler</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => changeTab("series")}
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-emerald-300 bg-emerald-50 px-1.5 text-[9.5px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          title="Tryk for at ændre afsnit"
                        >
                          <Tv className="h-3 w-3 shrink-0" aria-hidden />
                          <span>Afsnit {form.episodeNumbers.join(", ")}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!soloConfirmed ? (
                        <button
                          type="button"
                          onClick={() => changeTab("series")}
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-rose-300/80 bg-rose-100/90 px-1.5 text-[9.5px] font-medium text-rose-800 shadow-none transition-colors hover:bg-rose-200/90 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                          title="Medklipper mangler – tryk for at åbne Afsnit og medklippere"
                        >
                          <Scissors className="h-3 w-3 shrink-0" aria-hidden />
                          <span>Medklipper mangler</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => changeTab("series")}
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-emerald-300 bg-emerald-50 px-1.5 text-[9.5px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          title="Solo bekræftet – tryk for at ændre i Afsnit og medklippere"
                        >
                          <Scissors className="h-3 w-3 shrink-0" aria-hidden />
                          <span>Solo klip</span>
                        </button>
                      )}
                    </div>
                  </div>
                ),
              })}
              {baseRow({ key: "contractType", label: "Kontrakttype", sourceKey: "contractType", focusText: data.sources.contractType_focus, source: form.type !== contract.type ? "manual" : data.sources.contractType ? "contract" : contract.type ? "stored" : "unknown", missing: !form.type, children: <Select value={form.type} onValueChange={type => setForm(current => ({ ...current, type }))}><SelectTrigger className="h-6 w-fit min-w-32 gap-1.5 text-[11px] py-0 px-2" aria-label="Kontrakttype">{form.type === "leverandør" ? <Building2 className="h-3 w-3" /> : <BriefcaseBusiness className="h-3 w-3" />}<span>{form.type === "leverandør" ? "Leverandøraftale" : "A-løn"}</span></SelectTrigger><SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="leverandør">Leverandøraftale</SelectItem></SelectContent></Select> })}
              {baseRow({ key: "agreement", label: "Overenskomst", sourceKey: "collectiveAgreement", source: form.overenskomst === contract.overenskomst ? "contract" : "manual", missing: !form.overenskomst, children: <Select value={form.overenskomst} onValueChange={overenskomst => setForm(current => ({ ...current, overenskomst }))}><SelectTrigger className="h-6 w-fit min-w-32 text-[11px] py-0 px-2"><Scale className="h-3 w-3" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de4-fiktion">De4 (fiktion)</SelectItem><SelectItem value="faf">FAF (fiktion)</SelectItem><SelectItem value="faf-dokumentar">FAF (dokumentar)</SelectItem><SelectItem value="dj">DJ</SelectItem><SelectItem value="metal">Metal</SelectItem><SelectItem value="ingen">Ingen</SelectItem></SelectContent></Select> })}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t p-3">
              {isValidationRecommended && (
                <Badge className="bg-blue-600 text-white hover:bg-blue-600 text-xs px-2.5 py-1 shrink-0 font-medium">
                  Validering anbefalet
                </Badge>
              )}
              <Button onClick={() => void validate(false)} disabled={saving}><CheckCircle2 className="h-4 w-4" />Validér kontrakt</Button>
              <Button variant="outline" onClick={() => void validate(true)} disabled={saving || !queue?.nextContractId} title="Gemmer alle ændringer, validerer og åbner næste (⌘⏎)"><CheckCircle2 className="h-4 w-4" />Validér og næste <kbd className="rounded border px-1 font-mono text-[10px]">⌘⏎</kbd></Button>
              <Button variant="outline" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Gem</Button>
              <Button variant="outline" disabled={saving || !queue?.nextContractId} onClick={() => void saveAndNext()} title="Gemmer ændringer som kladde og åbner næste kontrakt"><Save className="h-4 w-4" />Gem og næste</Button>
              <Button variant="destructive" disabled={saving} onClick={() => setRejectOpen(true)}><XCircle className="h-4 w-4" />Afvis</Button>
            </div>
          </TabsContent>
          {data.canManageOwnership ? <TabsContent forceMount value="ownership" className="m-0 data-[state=inactive]:hidden">{visitedTabs.has("ownership") ? <ContractOwnershipEditor contractId={contract.id} canManage={data.canManageOwnership} inOwnershipQueue={queue?.kind === "ownership"} hasNext={Boolean(queue?.nextContractId)} commandTrigger={ownershipCommand} onEvidenceActivate={setActive} onCompleted={handleOwnershipCompleted} /> : null}</TabsContent> : null}
          <TabsContent forceMount value="messages" className="m-0 p-3 data-[state=inactive]:hidden">
            {visitedTabs.has("messages") ? <MessageThread
              title="Beskeder"
              messages={comments.map((comment): MessageThreadMessage => ({ id: comment.id, authorRole: comment.author_role, authorLabel: comment.participant_name ?? null, message: comment.message, createdAt: comment.created_at, memberReadAt: comment.member_read_at, adminReadAt: comment.admin_read_at }))}
              viewerRole="admin"
              memberLabel="Medlem"
              adminLabel="DFKS"
              composerValue={reply}
              onComposerChange={setReply}
              onSend={() => void sendReply()}
              composerLoading={replySaving}
              composerPlaceholder="Skriv svar til medlemmet"
              sendLabel="Send besked"
            /> : null}
          </TabsContent>
          {SECTIONS.filter(item => item.section).map(item => (
            <TabsContent forceMount key={item.key} value={item.key} className="m-0 p-2 data-[state=inactive]:hidden">
              {visitedTabs.has(item.key) ? (
                item.key === "series" && !isSeries ? (
                  <div className="rounded-md border p-4 text-sm text-muted-foreground">
                    Afsnit og medklippere er ikke relevant for denne kontrakt.
                  </div>
                ) : (
                  <>
                    {renderMissingSummary(item.key)}
                    {item.key === "series" && (
                      <div className="mb-3 rounded-lg border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">Medklippere og solo klip</span>
                          <span className={`text-[10px] font-medium ${soloConfirmed ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-400"}`}>
                            {soloConfirmed ? "Solo bekræftet" : "Mangler stillingtagen"}
                          </span>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={soloConfirmed}
                            onChange={event => {
                              const next = event.target.checked;
                              setSoloConfirmed(next);
                              setValidationData(curr => ({ ...curr, soloConfirmed: next }));
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <span>Rettighedshaver har klippet alene (solo - ingen medklippere)</span>
                        </label>
                      </div>
                    )}
                    {renderEditor(
                      item.key,
                      item.section!,
                      undefined,
                      item.key === "rights"
                        ? APPROVAL_RIGHT_KEYS
                        : item.key === "signature"
                        ? APPROVAL_SIGNATURE_KEYS
                        : undefined
                    )}
                  </>
                )
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </main>

    <Sheet open={queueSheetOpen} onOpenChange={setQueueSheetOpen}>
      <SheetContent side="right" className="w-[min(92vw,28rem)] overflow-y-auto">
        <SheetHeader><SheetTitle>{queue?.label ?? "Kontraktliste"}</SheetTitle><SheetDescription>Vælg en kontrakt på listen. Det aktive faneblad bevares.</SheetDescription></SheetHeader>
        <div className="mt-4 divide-y rounded-md border">{queue?.items.map(item => <button key={item.contractId} type="button" className={`flex w-full items-center gap-3 p-3 text-left hover:bg-muted ${item.contractId === contract.id ? "bg-muted" : ""}`} onClick={() => { setQueueSheetOpen(false); requestNavigate(item.contractId); }}><span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{item.position}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.ownershipStatus ? `Ejerskab: ${item.ownershipStatus}` : item.contractStatus}</span></span>{item.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}</button>)}</div>
      </SheetContent>
    </Sheet>

    <Sheet open={!splitLayout && mobileSourceView === "preview"} onOpenChange={open => setMobileSourceView(open ? "preview" : "closed")}>
      <SheetContent data-testid="contract-evidence-sheet" side="bottom" className="max-h-[82svh] gap-2 overflow-y-auto rounded-t-xl">
        <SheetHeader className="pr-10">
          <SheetTitle>{activeField?.label ?? "Kilde i kontrakten"}</SheetTitle>
          <SheetDescription>{activeEvidence ? `Kilde fra side ${contractEvidencePage(activeEvidence) ?? "ukendt"}` : "Der er ikke registreret en dokumentkilde til dette datapunkt."}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ContractEvidencePreview
            url={previewIsPdf ? previewDocument?.url ?? null : null}
            evidence={activeEvidence}
            label={activeField?.label ?? "Datapunkt"}
            onOpenDocument={openEvidenceDocument}
          />
        </div>
      </SheetContent>
    </Sheet>

    <Dialog open={!splitLayout && mobileSourceView === "document"} onOpenChange={open => setMobileSourceView(open ? "document" : "preview")}>
      <DialogContent data-testid="contract-mobile-document" showCloseButton={false} className="inset-0 top-0 left-0 h-[100svh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-0 sm:top-0 sm:left-0 sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0">
        <DialogHeader className="flex-row items-center gap-2 border-b px-3 py-2 text-left">
          <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={() => setMobileSourceView("preview")}><ArrowLeft className="h-4 w-4" />Tilbage</Button>
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">{activeField?.label ?? "Kilde i kontrakten"}</DialogTitle>
          <DialogDescription className="sr-only">Hele kontrakten med den valgte dokumentkilde markeret.</DialogDescription>
          <div className="flex shrink-0 rounded-md border bg-muted/30 p-0.5">
            <Button size="sm" className={`gap-1.5 ${variant === "original" ? "bg-background font-medium text-foreground shadow-xs" : ""}`} variant={variant === "original" ? "secondary" : "ghost"} disabled={!data.documents.original?.url} onClick={() => setVariant("original")}>
              {variant === "original" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
              {data.documents.original?.convertedForViewing ? "Original konverteret PDF" : "Original"}
            </Button>
            <Button size="sm" className={`gap-1.5 ${variant === "commented" ? "bg-background font-medium text-foreground shadow-xs" : ""}`} variant={variant === "commented" ? "secondary" : "ghost"} disabled={!data.documents.commented?.url} onClick={() => setVariant("commented")}>
              {variant === "commented" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
              Konverteret PDF
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {documentUrl ? documentIsPdf
            ? <PdfViewer key={`mobile-${contract.id}-${documentUrl}`} url={documentUrl} activeHighlight={activeField?.highlight || null} pageNavigationHint={activeField?.highlight || activeField?.quote || undefined} activePage={contractEvidencePage(activeEvidence)} layout={documentLayout} activeClauseId={documentLayout ? activeEvidence?.clauseId ?? null : null} activeEvidence={activeEvidence} resetViewToken={pdfResetToken} />
            : <ContractDocViewer url={documentUrl} filename={selectedDocument?.path} activeHighlight={activeField?.highlight || null} />
            : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen dokumentfil</div>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mangler før validering</DialogTitle>
          <DialogDescription>
            Følgende oplysninger er endnu ikke afklaret:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 rounded-md border border-rose-200 bg-rose-50/50 p-2.5 dark:border-rose-900/60 dark:bg-rose-950/20">
          {allMissing.filter(item => item.key !== "signatureStatus" && item.key !== "signatureDate").map(item => (
            <button
              key={`${item.tab}-${item.key}`}
              type="button"
              className="flex w-full items-center justify-between text-left text-xs font-medium text-rose-800 hover:underline dark:text-rose-300"
              onClick={() => {
                changeTab(item.tab);
                setValidateOpen(false);
                window.setTimeout(() => window.document.getElementById(`field-${item.key}`)?.scrollIntoView({ behavior: "smooth" }), 0);
              }}
            >
              <span>• {item.label}</span>
              <span className="text-[10px] text-muted-foreground">Gå til felt →</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Du kan gemme dine ændringer på kontrakten og fortsætte redigeringen, eller gemme og gå videre til næste kontrakt.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => setValidateOpen(false)}>
            Tilbage
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={async () => {
                setValidateOpen(false);
                await save();
              }}
            >
              Gem
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                setValidateOpen(false);
                const saved = await save();
                if (saved) {
                  if (queue?.nextContractId) {
                    navigateTo(queue.nextContractId);
                  } else {
                    router.push(safeContractReturnTo(returnTo));
                  }
                }
              }}
            >
              Gem og gå videre
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setValidateOpen(false);
                void completeValidation(validateAndNextRequested);
              }}
            >
              Validér alligevel
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={rejectOpen} onOpenChange={setRejectOpen}><DialogContent><DialogHeader><DialogTitle>Afvis kontrakten</DialogTitle><DialogDescription>Du kan sende en forklaring til brugeren. Kontrakten markeres som afvist i arkivet.</DialogDescription></DialogHeader><Textarea value={rejectMessage} onChange={event => setRejectMessage(event.target.value)} placeholder="Besked til brugeren (valgfri)" rows={5} />{!rejectMessage.trim() && <p className="text-xs text-amber-700">Der sendes ingen forklaring, hvis feltet er tomt.</p>}<DialogFooter><Button variant="outline" onClick={() => setRejectOpen(false)}>Annuller</Button><Button variant="destructive" disabled={saving} onClick={() => void reject()}>Afvis</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Trash2 className="h-5 w-5" />
            Slet kontrakt permanent?
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <span>
              Er du sikker på, at du vil slette denne kontrakt{holder?.full_name ? ` for ${holder.full_name}` : ""}?
            </span>
            <span className="block rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
              <strong>Advarsel:</strong> Handlingen kan ikke fortrydes. Kontraktfilen, OCR-data og alle tilknyttede oplysninger slettes permanent.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={deleting} onClick={() => setDeleteOpen(false)}>
            Annuller
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void handleDeleteContract()}>
            {deleting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
            Slet permanent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={validatedOpen} onOpenChange={setValidatedOpen}><DialogContent><DialogHeader><DialogTitle>Kontrakten er valideret</DialogTitle><DialogDescription>Du kan gå videre til næste kontrakt på listen eller vende tilbage til arkivet.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => router.push(safeContractReturnTo(returnTo))}>Tilbage til listen</Button><Button onClick={() => void openNext()}>Næste kontrakt</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null); }}><DialogContent><DialogHeader><DialogTitle>Du har ændringer, der ikke er gemt</DialogTitle><DialogDescription>Gem ændringerne før du skifter kontrakt, kassér dem, eller bliv på kontrakten.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingNavigation(null)}>Annuller</Button><Button variant="outline" onClick={() => { const target = pendingNavigation; setPendingNavigation(null); if (target) navigateTo(target); }}>Kassér</Button><Button onClick={() => void (async () => { const target = pendingNavigation; if (!target) return; if (await save()) { setPendingNavigation(null); navigateTo(target); } })()}>Gem og fortsæt</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
