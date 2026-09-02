"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase relation payloads are normalized at this client boundary. */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BriefcaseBusiness, Building2, CheckCircle2, ChevronLeft, ChevronRight, Download, ListChecks, Loader2, Save, Scale, Sparkles, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { addAdminContractComment, getAdminContractSeriesEpisodeOptions, queueAdminContractAiExtraction, updateAdminContract } from "@/app/actions/member-contracts";
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
import { emptyManualWorkForm, validateManualWork, type ManualWorkFormValue } from "@/lib/manual-work";
import type { ProductionCompanySelection } from "@/lib/production-companies";
import { buildCompleteEpisodeOptions, mergeEpisodeOptionsByPriority, type SeriesEpisodeOption } from "@/lib/series-episodes";
import { parseSeasonNumberFromTitle } from "@/lib/dfi-metadata";
import { contractEpisodeNumbersFromLayout, contractEvidencePage, fieldEvidence, safeContractReturnTo, suggestLocalContractWork, type ContractDocumentVariant, type ContractFieldEvidence, type ContractFieldSource, type ContractValidationMissingField, type ContractWorkbenchData } from "@/lib/contract-workbench";
import { CONTRACT_WORKBENCH_SPLIT_QUERY } from "@/lib/contract-workbench-responsive";
import type { ContractValidationSectionKey } from "@/app/actions/member-contracts";
import type { ContractEvidenceActivation } from "../../ContractAiDataEditor";
import type { ContractDocumentReviewAction, ContractDocumentReviewData } from "@/lib/contract-document-review";
import type { AdminContractQueueContext } from "@/lib/admin-contract-work-queue";
import { ContractOwnershipEditor } from "@/components/admin/contract-ownership-editor";

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
const SECTIONS: Array<{ key: string; label: string; section?: ContractValidationSectionKey }> = [
  { key: "approve", label: "Godkend" },
  { key: "ownership", label: "Ejerskab" },
  { key: "rights", label: "Rettigheder", section: "rights" },
  { key: "dates", label: "Dato", section: "dates" },
  { key: "salary", label: "Løn og periode", section: "salary" },
  { key: "series", label: "Seriedata", section: "series" },
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
  const [activeField, setActiveField] = useState<(ContractEvidenceActivation & { highlight: string }) | null>(null);
  const allowedInitialSection = SECTIONS.some(item => item.key === initialSection) && (initialSection !== "ownership" || data.canManageOwnership)
    ? initialSection!
    : "approve";
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
  const [validatedOpen, setValidatedOpen] = useState(false);
  const flushHandlersRef = useRef(new Map<string, () => Promise<boolean>>());
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([allowedInitialSection]));
  const [pdfResetToken, setPdfResetToken] = useState(0);
  const [documentReview, setDocumentReview] = useState<ContractDocumentReviewData | null>(null);
  const [documentReviewLoading, setDocumentReviewLoading] = useState(true);
  const [documentReviewAction, setDocumentReviewAction] = useState<ContractDocumentReviewAction | null>(null);
  const [documentReviewStatus, setDocumentReviewStatus] = useState<string | null>(null);

  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [workQuery, setWorkQuery] = useState(form.workingTitle);
  const [workResults, setWorkResults] = useState<UnifiedSearchWorkResult[]>([]);
  const [workSearching, setWorkSearching] = useState(false);
  const [workSearched, setWorkSearched] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const [selectedWorkResult, setSelectedWorkResult] = useState<UnifiedSearchWorkResult | null>(null);
  const [workTypeFilter, setWorkTypeFilter] = useState("all");
  const [manualWorkMode, setManualWorkMode] = useState(false);
  const [manualWork, setManualWork] = useState<ManualWorkFormValue>(() => emptyManualWorkForm({ title: form.workingTitle, contract_id: contract.id }));
  const [episodeOptions, setEpisodeOptions] = useState<SeriesEpisodeOption[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const seriesOptionsKey = useRef<string | null>(null);
  const editorInitialData = useMemo(() => ({ ...validationData, _sources: data.sources }), [data.sources, validationData]);

  useAdminPageTitle(form.workingTitle || linkedWork?.title || "Rediger kontrakt");

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
    void createAdminContractWorkQueue({ kind: "filtered", filters: queueFiltersFromReturnTo(returnTo) }).then(result => {
      if (!result.success) return;
      if (!result.queueId) return;
      setQueueId(result.queueId);
      void loadQueue(result.queueId);
    });
  }, [loadQueue, queueId, returnTo]);

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
    if (isSeries && form.episodeNumbers.length === 0) add("series", "episodeNumbers", "Valgte afsnit");
    if (triState(validationData.signatureStatus) === "unknown") add("approve", "signatureStatus", "Underskrevet");
    if (!validationData.signatureDate) add("approve", "signatureDate", "Underskriftsdato");
    if (activeWork && !activeWork.dfi_id && !activeWork.tmdb_id && !activeWork.imdb_id) add("ids", "externalIds", "Eksternt værk-ID");
    if (!validationData.productionType && !validationData.director) add("work", "workDetails", "Produktionstype eller instruktør");
    return result;
  }, [activeWork, contract.rights_holder_id, form, isSeries, manualWorkMode, producerSelections.length, selectedWorkResult, validationData]);
  const missing = missingByTab.approve;
  const allMissing = useMemo(() => Object.values(missingByTab).flat(), [missingByTab]);
  const tabCounts = useMemo(() => Object.fromEntries(Object.entries(missingByTab).map(([key, items]) => [key, items.length])), [missingByTab]);

  const setActive = (evidence: ContractEvidenceActivation) => {
    const coordinateEvidence = data.evidence?.[evidence.sourceKey] ?? data.evidence?.[evidence.fieldKey];
    if ((evidence.bbox || coordinateEvidence?.bbox) && data.documents.commented?.url) setVariant("commented");
    const highlight = evidence.quote ? evidence.focusText?.trim() || evidence.quote : "";
    const next = { ...evidence, highlight };
    if (!evidence.quote.trim()) {
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
    setActiveField(current => current?.fieldKey === evidence.fieldKey ? null : next);
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
    const activation: ContractEvidenceActivation = { fieldKey: args.key, label: args.label, sourceKey: args.sourceKey, quote: evidence.quote ?? "", focusText: args.focusText, clauseId: evidence.clauseId, page: evidence.clause?.page ?? evidence.page };
    const activateFromRow = (event: MouseEvent) => {
      if ((event.target as Element).closest("button,input,select,textarea,a,[role='combobox']")) return;
      setActive(activation);
    };
    return <div id={`field-${args.key}`} data-review-row tabIndex={0} onFocus={() => setActive(activation)} onKeyDown={event => {
      if (event.key === "Escape" && event.target !== event.currentTarget) { event.preventDefault(); event.currentTarget.focus(); return; }
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); const control = event.currentTarget.querySelector<HTMLElement>("input,button,select,textarea,[role='combobox']"); control?.focus(); return; }
      if (event.key === "Tab") {
        const rows = [...event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-review-row]") ?? []];
        const index = rows.indexOf(event.currentTarget);
        const next = rows[index + (event.shiftKey ? -1 : 1)];
        if (next) { event.preventDefault(); next.focus(); }
      }
    }} onClick={activateFromRow} className={`grid min-h-11 cursor-pointer grid-cols-[minmax(88px,0.4fr)_minmax(0,1.6fr)_auto] items-center gap-1.5 border-b px-2 py-1.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring last:border-b-0 sm:grid-cols-[minmax(105px,0.45fr)_minmax(0,1.55fr)_auto] sm:gap-2 ${activeField?.fieldKey === args.key ? "bg-amber-50 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/20" : ""} ${args.missing ? "bg-amber-50/70 dark:bg-amber-950/15" : ""}`}>
      <div className="flex min-w-0 items-center gap-1"><Label className="truncate text-[11px] font-medium">{args.label}</Label>{args.missing && <Badge className="h-4 rounded-sm bg-amber-500 px-1 text-[8px] text-white">Mangler</Badge>}</div>
      <div className="min-w-0">{args.children}</div>
      <ContractSourceBadge source={args.source} />
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

  async function searchWorks() {
    const query = workQuery.trim();
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
    const success = await save("valideret", !goNext);
    if (!success) return;
    if (queueId) await markAdminContractQueueItem(queueId, contract.id, "completed");
    if (goNext) navigateTo(queue?.nextContractId ?? null);
  }

  async function validate(goNext = false) {
    if (allMissing.length) {
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
    const next = new URLSearchParams(window.location.search);
    next.set("section", nextTab);
    router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (tab === "approve") document.getElementById("field-rightsHolder")?.focus();
      else if (tab === "ownership") document.querySelector<HTMLElement>("[aria-labelledby='ownership-heading'] button")?.focus();
      else document.querySelector<HTMLElement>(`[data-state='active'][data-slot='tabs-content'] [data-review-row], [data-state='active'][data-slot='tabs-content'] input, [data-state='active'][data-slot='tabs-content'] button`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
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

  function contractEditorUrl(nextContractId: string) {
    const params = new URLSearchParams({ returnTo, section: tab });
    if (queueId) params.set("queueId", queueId);
    return `/admin/kontrakter/${nextContractId}/rediger?${params.toString()}`;
  }

  function navigateTo(nextContractId: string | null) {
    if (!nextContractId) {
      toast.info("Du er nået til slutningen af køen");
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

  async function startQueue(kind: "validation" | "ownership") {
    const result = await createAdminContractWorkQueue({ kind, filters: queueFiltersFromReturnTo(returnTo) });
    if (!result.success) return toast.error(result.error);
    if (!result.queueId || !result.firstContractId) return toast.error("Køen kunne ikke åbnes");
    setQueueId(result.queueId);
    if (result.firstContractId === contract.id) await loadQueue(result.queueId);
    else {
      const section = kind === "ownership" ? "ownership" : "approve";
      const params = new URLSearchParams({ returnTo, queueId: result.queueId, section });
      router.push(`/admin/kontrakter/${result.firstContractId}/rediger?${params.toString()}`);
    }
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
        else if (tab === "approve") void validate(Boolean(queue));
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
      onEvidenceActivate={setActive}
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
    return <div className="m-2 rounded-sm border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <span className="font-medium">Mangler:</span> {items.map(item => item.label).join(" · ")}
    </div>;
  };

  return <div className={`-mx-3 -my-3 flex min-h-[calc(100svh-4rem)] flex-col bg-background sm:-mx-4 sm:-my-4 ${splitLayout ? "h-[calc(100svh-4rem)] min-h-0 overflow-hidden sm:-mx-6 sm:-my-6" : ""}`}>
    <header className="sticky top-0 z-30 border-b bg-background/95 px-2 py-1.5 backdrop-blur sm:px-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => router.push(safeContractReturnTo(returnTo))}><ArrowLeft className="h-3.5 w-3.5" />Tilbage</Button>
        <div className="hidden min-w-0 flex-1 md:block"><p className="truncate text-xs font-semibold">{form.workingTitle || linkedWork?.title || "Kontrakt"}</p><p className="truncate text-[10px] text-muted-foreground">{producerSelections[0]?.canonicalName ?? employer?.name ?? "Ingen producent"} · {holder?.full_name ?? "Ingen rettighedshaver"}</p></div>
        <Badge variant="outline" className="h-6 shrink-0 rounded-sm px-1.5 text-[10px]">{contract.status === "valideret" ? "Valideret" : contract.status === "arkiveret" ? "Afvist" : "Afventer"}</Badge>
        <div className="flex h-8 shrink-0 items-center rounded-sm border bg-background" aria-label="Kønavigation">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={queueLoading || !queue?.previousContractId} onClick={() => requestNavigate(queue?.previousContractId ?? null)} aria-label="Forrige kontrakt"><ChevronLeft className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" className="h-7 min-w-14 px-1.5 text-[10px]" disabled={queueLoading || !queue} onClick={() => setQueueSheetOpen(true)} aria-label="Vis kontraktkø">{queueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : queue ? `${queue.position} / ${queue.total}` : "– / –"}</Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={queueLoading || !queue?.nextContractId} onClick={() => requestNavigate(queue?.nextContractId ?? null)} aria-label="Næste kontrakt"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex shrink-0 rounded-sm border bg-muted/30 p-0.5">
          <Button size="sm" className="h-7 shrink-0 rounded-sm px-2 text-xs" variant={variant === "original" ? "secondary" : "ghost"} disabled={!data.documents.original?.url} onClick={() => setVariant("original")}>Original</Button>
          <Button size="sm" className="h-7 shrink-0 rounded-sm px-2 text-xs" variant={variant === "commented" ? "secondary" : "ghost"} disabled={!data.documents.commented?.url} onClick={() => setVariant("commented")}>Kommenteret PDF</Button>
        </div>
        {data.documents.original?.sourceUrl && <Button asChild size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Download uændret original"><a href={data.documents.original.sourceUrl} download><Download className="h-3.5 w-3.5" /><span className="sr-only">Download uændret original</span></a></Button>}
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving || aiReading} onClick={() => void runAiReading()}>{aiReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}AI-aflæsning</Button>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Gem</Button>
        <Button size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving} onClick={() => void validate()}><CheckCircle2 className="h-3.5 w-3.5" />Valider</Button>
        <Button size="sm" variant="destructive" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={saving} onClick={() => setRejectOpen(true)}><XCircle className="h-3.5 w-3.5" />Afvis</Button>
      </div>
      {data.documents.original?.convertedForViewing && variant === "original" && <p className="mt-1 text-[10px] text-muted-foreground">Original vises som en neutral PDF-konvertering af Word-filen. Download-knappen henter den uændrede original.</p>}
      {!splitLayout && <div className="mt-1 flex gap-1"><Button size="sm" className="h-7 text-xs" variant={mobilePane === "document" ? "default" : "outline"} onClick={() => setMobilePane("document")}>Dokument</Button><Button size="sm" className="h-7 text-xs" variant={mobilePane === "data" ? "default" : "outline"} onClick={() => setMobilePane("data")}>Kilder og data</Button></div>}
    </header>

    <main className={`grid min-h-0 flex-1 ${splitLayout ? "grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)] min-[1200px]:grid-cols-[minmax(420px,1fr)_minmax(620px,1.2fr)]" : ""}`}>
      <section data-testid="contract-document-pane" className={`${splitLayout || mobilePane === "document" ? "block" : "hidden"} min-w-0 overflow-hidden border-r ${splitLayout ? "min-h-0" : "min-h-[70svh]"}`}>
        {documentUrl ? documentIsPdf ? <PdfViewer url={documentUrl} activeHighlight={activeField?.highlight ?? null} pageNavigationHint={activeField?.highlight ?? activeField?.quote ?? undefined} activePage={contractEvidencePage(activeEvidence)} layout={documentLayout} activeClauseId={documentLayout ? activeEvidence?.clauseId ?? null : null} activeEvidence={activeEvidence} resetViewToken={pdfResetToken} /> : <ContractDocViewer url={documentUrl} filename={selectedDocument?.path} activeHighlight={activeField?.highlight ?? null} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen dokumentfil</div>}
      </section>

      <section data-testid="contract-data-pane" className={`${splitLayout || mobilePane === "data" ? "block" : "hidden"} relative z-10 min-h-0 min-w-0 bg-background ${splitLayout ? "overflow-y-auto" : ""}`}>
        <DocumentProcessingReviewCard review={documentReview} loading={documentReviewLoading} activeAction={documentReviewAction} statusMessage={documentReviewStatus} onAction={action => void handleDocumentReviewAction(action)} />
        <div className="hidden flex-wrap items-center gap-1 border-b bg-muted/20 px-3 py-1 min-[1440px]:flex"><span className="mr-1 text-[10px] font-medium">Datakilde:</span>{(["contract", "agreement", "member", "work_archive", "dfi", "tmdb", "wikidata", "manual"] as ContractFieldSource[]).map(source => <ContractSourceBadge key={source} source={source} />)}</div>
        <Tabs value={tab} onValueChange={changeTab} className="min-h-0 gap-0">
          <TabsList variant="line" className="sticky top-0 z-20 h-8 w-full justify-start overflow-x-auto rounded-none border-b bg-background px-2 py-0.5">
            {SECTIONS.filter(item => item.key !== "ownership" || data.canManageOwnership).map(item => <TabsTrigger key={item.key} value={item.key} className="h-7 flex-none px-2 py-1 text-xs font-medium">{item.label}{tabCounts[item.key] > 0 && <Badge className="ml-1 h-3.5 min-w-3.5 rounded-sm bg-amber-500 px-0.5 text-[8px] font-medium leading-none text-white">{tabCounts[item.key]}</Badge>}</TabsTrigger>)}
          </TabsList>

          <TabsContent forceMount value="approve" className="m-0 data-[state=inactive]:hidden">
            {missing.length > 0 && <div className="m-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><span className="font-medium">{missing.length} mangler:</span> {missing.map(item => item.label).join(" · ")}</div>}
            <div className="divide-y">
              {baseRow({ key: "rightsHolder", label: "Rettighedshaver", sourceKey: "rightsHolderName", focusText: holder?.full_name ?? null, source: "unknown", missing: !contract.rights_holder_id, children: <div className="flex min-h-8 flex-col justify-center rounded-md border bg-muted/30 px-2 py-1"><span className="truncate text-sm font-medium">{holder?.full_name ?? "Ingen rettighedshaver tilknyttet"}</span>{data.canManageOwnership ? <button type="button" className="w-fit text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => changeTab("ownership")}>Åbn Ejerskab</button> : null}</div> })}
              {baseRow({ key: "producer", label: "Producent", sourceKey: "employerName", focusText: producerSelections[0]?.canonicalName ?? (String(validationData.employerName ?? employer?.name ?? "") || null), source: producerSelections.length ? (producerSelections[0]?.employerId === contract.employer_id ? "contract" : "manual") : data.sources.employerName ? "contract" : "unknown", missing: !producerSelections.length, children: <ProductionCompanyPicker value={producerSelections} onChange={setProducerSelections} suggestedName={String(validationData.employerName ?? employer?.name ?? "")} canManageRegistry hideLabel compact /> })}
              {baseRow({ key: "work", label: "Tilknyttet værk", sourceKey: "workTitle", focusText: form.workingTitle || displayedWorkTitle, source: form.workId ? "work_archive" : data.sources.workTitle ? "contract" : "manual", missing: !form.workId && !selectedWorkResult && !manualWorkMode, children: <div className="space-y-1"><div className="flex min-h-8 items-center gap-1 rounded-md border px-2 text-xs"><span className="min-w-0 flex-1 truncate">{form.workId || selectedWorkResult ? displayedWorkLabel : `Arbejdstitel: ${form.workingTitle || "Ingen"}`}</span>{form.workId || selectedWorkResult ? <><Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5 text-xs" onClick={() => setWorkPickerOpen(open => !open)}>{workPickerOpen ? "Luk" : "Skift"}</Button><button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fjern tilknyttet værk" onClick={() => { setForm(current => ({ ...current, workId: "" })); setSelectedWorkResult(null); setManualWorkMode(false); }}><X className="h-3.5 w-3.5" /></button></> : <Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5 text-xs" onClick={() => setWorkPickerOpen(open => !open)}>{workPickerOpen ? "Luk" : "Søg værk"}</Button>}</div>{localWorkSuggestion && !workPickerOpen && <button type="button" className="flex w-full items-center justify-between rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" onClick={() => { setForm(current => ({ ...current, workId: localWorkSuggestion.id, seasonNumber: parseSeasonNumberFromTitle(current.workingTitle) ?? current.seasonNumber })); setWorkQuery(localWorkSuggestion.title); }}><span className="truncate">Foreslået: {localWorkSuggestion.title}{parseSeasonNumberFromTitle(form.workingTitle) ? ` · sæson ${parseSeasonNumberFromTitle(form.workingTitle)}` : ""}</span><span className="ml-2 shrink-0 font-medium">Tilknyt</span></button>}{workPickerOpen && <WorkSelectionPanel query={workQuery} onQueryChange={setWorkQuery} onSearch={() => void searchWorks()} isSearching={workSearching} hasSearched={workSearched} searchError={workError} results={workResults} selectedId={selectedWorkResult?.id} onSelect={result => void chooseWork(result)} typeFilter={workTypeFilter} onTypeFilterChange={setWorkTypeFilter} manualMode={manualWorkMode} onManualModeChange={setManualWorkMode} manualWork={manualWork} onManualWorkChange={setManualWork} locale="da" autoSelectManualProducer />}</div> })}
              {baseRow({ key: "contractType", label: "Kontrakttype", sourceKey: "contractType", focusText: data.sources.contractType_focus, source: form.type !== contract.type ? "manual" : data.sources.contractType ? "contract" : "unknown", missing: !form.type, children: <div className="inline-flex h-8 items-center rounded-md border bg-background p-0.5" role="group" aria-label="Kontrakttype"><button type="button" aria-label="A-løn" aria-pressed={form.type === "a-løn"} title="A-løn" onClick={() => setForm(current => ({ ...current, type: "a-løn" }))} className={`flex h-7 w-8 items-center justify-center rounded-sm transition-colors ${form.type === "a-løn" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}><BriefcaseBusiness className="h-4 w-4" /></button><button type="button" aria-label="Leverandør" aria-pressed={form.type === "leverandør"} title="Leverandør" onClick={() => setForm(current => ({ ...current, type: "leverandør" }))} className={`flex h-7 w-8 items-center justify-center rounded-sm transition-colors ${form.type === "leverandør" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}><Building2 className="h-4 w-4" /></button></div> })}
              {baseRow({ key: "agreement", label: "Overenskomst", sourceKey: "collectiveAgreement", source: form.overenskomst === contract.overenskomst ? "contract" : "manual", missing: !form.overenskomst, children: <Select value={form.overenskomst} onValueChange={overenskomst => setForm(current => ({ ...current, overenskomst }))}><SelectTrigger className="h-8 w-fit min-w-36 text-xs"><Scale className="h-3.5 w-3.5" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de4-fiktion">De4 (fiktion)</SelectItem><SelectItem value="faf">FAF (fiktion)</SelectItem><SelectItem value="faf-dokumentar">FAF (dokumentar)</SelectItem><SelectItem value="dj">DJ</SelectItem><SelectItem value="metal">Metal</SelectItem><SelectItem value="ingen">Ingen</SelectItem></SelectContent></Select> })}
            </div>
            <div className="border-t">{renderEditor("approve", "approval")}</div>
            <div className="flex flex-wrap gap-2 border-t p-3"><Button onClick={() => void validate(false)} disabled={saving}><CheckCircle2 className="h-4 w-4" />Validér kontrakt</Button><Button variant="outline" onClick={() => void validate(true)} disabled={saving || !queue}><CheckCircle2 className="h-4 w-4" />Validér og næste</Button><Button variant="outline" onClick={() => void startQueue("validation")}><ListChecks className="h-4 w-4" />Start valideringskø</Button></div>
          </TabsContent>
          {data.canManageOwnership ? <TabsContent forceMount value="ownership" className="m-0 data-[state=inactive]:hidden">{visitedTabs.has("ownership") ? <><ContractOwnershipEditor contractId={contract.id} canManage={data.canManageOwnership} queueActive={Boolean(queue)} commandTrigger={ownershipCommand} onEvidenceActivate={setActive} onCompleted={handleOwnershipCompleted} /><div className="px-3 pb-3"><Button variant="outline" onClick={() => void startQueue("ownership")}><ListChecks className="h-4 w-4" />Start ejerskabskø</Button></div></> : null}</TabsContent> : null}
          {SECTIONS.filter(item => item.section).map(item => <TabsContent forceMount key={item.key} value={item.key} className="m-0 p-2 data-[state=inactive]:hidden">{visitedTabs.has(item.key) ? item.key === "series" && !isSeries ? <div className="rounded-md border p-4 text-sm text-muted-foreground">Seriedata er ikke relevant for denne kontrakt.</div> : <>{renderMissingSummary(item.key)}{renderEditor(item.key, item.section!, undefined, item.key === "rights" ? APPROVAL_RIGHT_KEYS : item.key === "signature" ? APPROVAL_SIGNATURE_KEYS : undefined)}</> : null}</TabsContent>)}
        </Tabs>
      </section>
    </main>

    <Sheet open={queueSheetOpen} onOpenChange={setQueueSheetOpen}>
      <SheetContent side="right" className="w-[min(92vw,28rem)] overflow-y-auto">
        <SheetHeader><SheetTitle>{queue?.label ?? "Kontraktkø"}</SheetTitle><SheetDescription>Vælg en kontrakt i køen. Det aktive faneblad bevares.</SheetDescription></SheetHeader>
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
            <Button size="sm" variant={variant === "original" ? "secondary" : "ghost"} disabled={!data.documents.original?.url} onClick={() => setVariant("original")}>Original</Button>
            <Button size="sm" variant={variant === "commented" ? "secondary" : "ghost"} disabled={!data.documents.commented?.url} onClick={() => setVariant("commented")}>Kommenteret PDF</Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {documentUrl ? documentIsPdf
            ? <PdfViewer url={documentUrl} activeHighlight={activeField?.highlight || null} pageNavigationHint={activeField?.highlight || activeField?.quote || undefined} activePage={contractEvidencePage(activeEvidence)} layout={documentLayout} activeClauseId={documentLayout ? activeEvidence?.clauseId ?? null : null} activeEvidence={activeEvidence} resetViewToken={pdfResetToken} />
            : <ContractDocViewer url={documentUrl} filename={selectedDocument?.path} activeHighlight={activeField?.highlight || null} />
            : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Ingen dokumentfil</div>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={validateOpen} onOpenChange={setValidateOpen}><DialogContent><DialogHeader><DialogTitle>Valider med manglende oplysninger?</DialogTitle><DialogDescription>Følgende oplysninger er ikke afklaret: {allMissing.map(item => item.label).join(", ")}. Du kan stadig validere efter bekræftelse.</DialogDescription></DialogHeader><div className="space-y-1">{allMissing.map(item => <button key={`${item.tab}-${item.key}`} className="block text-sm text-amber-700 underline" onClick={() => { changeTab(item.tab); setValidateOpen(false); window.setTimeout(() => window.document.getElementById(`field-${item.key}`)?.scrollIntoView({ behavior: "smooth" }), 0); }}>{item.label}</button>)}</div><DialogFooter><Button variant="outline" onClick={() => setValidateOpen(false)}>Tilbage</Button><Button onClick={() => { setValidateOpen(false); void completeValidation(validateAndNextRequested); }}>Valider alligevel{validateAndNextRequested ? " og gå videre" : ""}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={rejectOpen} onOpenChange={setRejectOpen}><DialogContent><DialogHeader><DialogTitle>Afvis kontrakten</DialogTitle><DialogDescription>Du kan sende en forklaring til brugeren. Kontrakten markeres som afvist i arkivet.</DialogDescription></DialogHeader><Textarea value={rejectMessage} onChange={event => setRejectMessage(event.target.value)} placeholder="Besked til brugeren (valgfri)" rows={5} />{!rejectMessage.trim() && <p className="text-xs text-amber-700">Der sendes ingen forklaring, hvis feltet er tomt.</p>}<DialogFooter><Button variant="outline" onClick={() => setRejectOpen(false)}>Annuller</Button><Button variant="destructive" disabled={saving} onClick={() => void reject()}>Afvis</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={validatedOpen} onOpenChange={setValidatedOpen}><DialogContent><DialogHeader><DialogTitle>Kontrakten er valideret</DialogTitle><DialogDescription>Du kan gå videre til næste kontrakt i køen eller vende tilbage til listen.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => router.push(safeContractReturnTo(returnTo))}>Tilbage til listen</Button><Button onClick={() => void openNext()}>Næste kontrakt</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null); }}><DialogContent><DialogHeader><DialogTitle>Du har ændringer, der ikke er gemt</DialogTitle><DialogDescription>Gem ændringerne før du skifter kontrakt, kassér dem, eller bliv på kontrakten.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingNavigation(null)}>Annuller</Button><Button variant="outline" onClick={() => { const target = pendingNavigation; setPendingNavigation(null); if (target) navigateTo(target); }}>Kassér</Button><Button onClick={() => void (async () => { const target = pendingNavigation; if (!target) return; if (await save()) { setPendingNavigation(null); navigateTo(target); } })()}>Gem og fortsæt</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
