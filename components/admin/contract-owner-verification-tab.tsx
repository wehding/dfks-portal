"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, FileSearch, Loader2, Search, ShieldAlert, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { findOwnersForContracts } from "@/app/actions/contract-imports";
import {
  bulkConfirmContractOwners,
  fetchContractOwnerVerificationDetail,
  fetchContractOwnerVerificationPage,
  reviewContractOwnerVerification,
  searchEligibleContractOwners,
} from "@/app/actions/contract-owner-verifications";
import { ListResultSummary } from "@/components/list-result-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  canSafelyBulkConfirm,
  canRequestOwnerSuggestion,
  contractOwnerOptionLabel,
  contractOwnerOriginLabel,
  contractOwnerStatusLabel,
  normalizeContractOwnerBlockReason,
} from "@/lib/contract-owner-verification-ui";
import {
  CONTRACT_OWNER_ASSIGNMENT_ORIGINS,
  CONTRACT_OWNER_VERIFICATION_STATUSES,
  type ContractOwnerAssignmentOrigin,
  type ContractOwnerSummary,
  type ContractOwnerVerificationDetail,
  type ContractOwnerVerificationListItem,
  type ContractOwnerVerificationStatus,
} from "@/lib/contract-owner-verification-types";

type PendingDecision =
  | { decision: "confirm"; nextOwner: ContractOwnerSummary }
  | { decision: "reassign"; nextOwner: ContractOwnerSummary }
  | { decision: "blocked"; nextOwner: null };

const STATUS_OPTIONS = CONTRACT_OWNER_VERIFICATION_STATUSES;
const ORIGIN_OPTIONS = CONTRACT_OWNER_ASSIGNMENT_ORIGINS;
const MAX_UI_BULK_CONFIRM = 25;
const MAX_UI_OWNER_SUGGESTIONS = 100;

function statusTone(status: string) {
  if (["confirmed", "corrected"].includes(status)) return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
  if (["conflict", "blocked"].includes(status)) return "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
  if (status === "not_applicable") return "border-border bg-muted/40 text-muted-foreground";
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
}

function OwnerStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={statusTone(status)}>{contractOwnerStatusLabel(status)}</Badge>;
}

function OwnerSummaryText({ owner, emptyLabel }: { owner: ContractOwnerSummary | null; emptyLabel: string }) {
  if (!owner) return <span className="text-muted-foreground">{emptyLabel}</span>;
  return <span><span className="block">{owner.name}</span>{owner.secondaryLabel ? <span className="block text-xs text-muted-foreground">{owner.secondaryLabel}</span> : null}</span>;
}

function VersionBadge({ item }: { item: ContractOwnerVerificationListItem }) {
  if (item.versionCount <= 1) return null;
  return <Badge variant="outline" className="whitespace-nowrap text-[10px]">
    {item.isCurrentVersion ? "Aktuel version" : `Tidligere version ${item.versionIndex}`} · {item.versionCount} i alt
  </Badge>;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function documentProcessingLabel(status: string | null) {
  const labels: Record<string, string> = {
    pending: "Afventer dokumentbehandling",
    queued: "I kø",
    processing: "Behandles",
    completed: "Færdigbehandlet",
    ready: "Færdigbehandlet",
    needs_review: "Kræver manuel kontrol",
    failed: "Behandling fejlede",
    not_required: "OCR var ikke nødvendig",
  };
  return status ? labels[status] ?? status : "Ukendt";
}

function coordinateSourceLabel(source: string) {
  const labels: Record<string, string> = {
    spatial_v3: "Geometrisk OCR-kilde",
    native_pdf: "PDF-koordinater",
    legacy_layout: "Ældre layoutkoordinater",
  };
  return labels[source] ?? source;
}

export function ContractOwnerVerificationTab({ initialContractId }: { initialContractId?: string | null }) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ContractOwnerVerificationListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState<ContractOwnerVerificationStatus | "all">("all");
  const [origin, setOrigin] = useState<ContractOwnerAssignmentOrigin | "all">("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFindingOwners, setBulkFindingOwners] = useState(false);
  const [detail, setDetail] = useState<ContractOwnerVerificationDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<ContractOwnerSummary | null>(null);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerCandidates, setOwnerCandidates] = useState<ContractOwnerSummary[]>([]);
  const [ownerSearchLoading, setOwnerSearchLoading] = useState(false);
  const [ownerSearchPerformed, setOwnerSearchPerformed] = useState(false);
  const [findingOwner, setFindingOwner] = useState(false);
  const [blockReason, setBlockReason] = useState("manual_review_required");
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const openedContractFromUrl = useRef<string | null>(null);
  const pageRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const findOwnerRequestRef = useRef(0);
  const ownerSearchRequestRef = useRef(0);

  useEffect(() => () => {
    pageRequestRef.current += 1;
    detailRequestRef.current += 1;
    findOwnerRequestRef.current += 1;
    ownerSearchRequestRef.current += 1;
  }, []);

  const syncContractInUrl = useCallback((contractId: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "ejerskabskontrol");
    if (contractId) next.set("contractId", contractId);
    else next.delete("contractId");
    window.history.replaceState(null, "", `/admin/kontrakter?${next.toString()}`);
  }, [searchParams]);

  const loadPage = useCallback(async () => {
    const requestId = ++pageRequestRef.current;
    setLoading(true);
    try {
      const result = await fetchContractOwnerVerificationPage({
        page,
        pageSize,
        search: submittedSearch,
        status,
        assignmentOrigin: origin,
      });
      if (!result.success) throw new Error(result.error);
      if (requestId !== pageRequestRef.current) return;
      const data = result.data;
      const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (data.page > lastPage) {
        setItems([]);
        setTotal(data.total);
        setSelected(new Set());
        setPage(lastPage);
        return;
      }
      setItems(data.items);
      setPage(data.page);
      setPageSize(data.pageSize);
      setTotal(data.total);
      setSelected(current => new Set([...current].filter(id => data.items.some(item => (
        item.contractId === id && canRequestOwnerSuggestion(item)
      )))));
    } catch (error) {
      if (requestId !== pageRequestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Ejerskabskøen kunne ikke hentes");
      setItems([]);
      setTotal(0);
      setSelected(new Set());
    } finally {
      if (requestId === pageRequestRef.current) setLoading(false);
    }
  }, [origin, page, pageSize, status, submittedSearch]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  function submitSearch() {
    const next = search.trim();
    setPage(1);
    if (next === submittedSearch) void loadPage();
    else setSubmittedSearch(next);
  }

  const openDetail = useCallback(async (contractId: string) => {
    const requestId = ++detailRequestRef.current;
    ownerSearchRequestRef.current += 1;
    openedContractFromUrl.current = contractId;
    syncContractInUrl(contractId);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setSelectedOwner(null);
    setOwnerSearch("");
    setOwnerCandidates([]);
    setOwnerSearchLoading(false);
    setOwnerSearchPerformed(false);
    setPendingDecision(null);
    try {
      const result = await fetchContractOwnerVerificationDetail(contractId);
      if (!result.success) throw new Error(result.error);
      if (requestId !== detailRequestRef.current) return;
      const next = result.data;
      setDetail(next);
      setSelectedOwner(next.proposedRightsHolder ?? next.assignedRightsHolder ?? null);
      setBlockReason(normalizeContractOwnerBlockReason(next.verification.reasonCode));
    } catch (error) {
      if (requestId !== detailRequestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Ejerskabsdetaljerne kunne ikke hentes");
      setDetailOpen(false);
      syncContractInUrl(null);
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [syncContractInUrl]);

  useEffect(() => {
    if (!initialContractId) {
      openedContractFromUrl.current = null;
      return;
    }
    if (openedContractFromUrl.current === initialContractId) return;
    openedContractFromUrl.current = initialContractId;
    void openDetail(initialContractId);
  }, [initialContractId, openDetail]);

  const bulkConfirmEligible = useMemo(
    () => items.filter(item => selected.has(item.contractId) && canSafelyBulkConfirm(item)),
    [items, selected],
  );
  const bulkBatch = bulkConfirmEligible.slice(0, MAX_UI_BULK_CONFIRM);
  const ownerSuggestionEligible = useMemo(
    () => items.filter(item => selected.has(item.contractId) && canRequestOwnerSuggestion(item)),
    [items, selected],
  );
  const ownerSuggestionBatch = ownerSuggestionEligible.slice(0, MAX_UI_OWNER_SUGGESTIONS);
  const selectedCount = selected.size;
  const selectableOnPage = useMemo(() => items.filter(canRequestOwnerSuggestion), [items]);
  const allSelectableSelected = selectableOnPage.length > 0 && selectableOnPage.every(item => selected.has(item.contractId));
  const bulkBusy = bulkSaving || bulkFindingOwners;

  function toggleSelectablePage() {
    setSelected(current => {
      const next = new Set(current);
      if (allSelectableSelected) selectableOnPage.forEach(item => next.delete(item.contractId));
      else selectableOnPage.forEach(item => next.add(item.contractId));
      return next;
    });
  }

  async function findOwnerSuggestionsForSelected() {
    if (ownerSuggestionBatch.length === 0) return;
    setBulkFindingOwners(true);
    try {
      const result = await findOwnersForContracts(ownerSuggestionBatch.map(item => item.contractId));
      if (!result.success) throw new Error(result.error ?? "Ejerforslagene kunne ikke findes");
      const summary = `${result.matched} matchet · ${result.unresolved} uden sikkert forslag · ${result.skipped} sprunget over`;
      if (result.matched > 0) toast.success("Ejerforslagene er opdateret", { description: summary });
      else toast.info("Ingen nye sikre ejerforslag", { description: summary });
      await loadPage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ejerforslagene kunne ikke findes");
    } finally {
      setBulkFindingOwners(false);
    }
  }

  async function confirmSelected() {
    setBulkSaving(true);
    try {
      const result = await bulkConfirmContractOwners(bulkBatch.flatMap(item => (
        item.assignedRightsHolder ? [{
          contractId: item.contractId,
          expectedRightsHolderId: item.assignedRightsHolder.id,
          expectedRevision: item.revision,
        }] : []
      )));
      if (!result.success) throw new Error(result.error);
      const completedIds = new Set(result.results.filter(item => item.success).map(item => item.contractId));
      setSelected(current => new Set([...current].filter(id => !completedIds.has(id))));
      setBulkOpen(false);
      if (result.completed > 0) {
        toast.success(`${result.completed} kontrakt${result.completed === 1 ? "" : "er"} fik ejeren bekræftet`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} kræver fortsat individuel kontrol`);
      }
      await loadPage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ejerskabskontrollen kunne ikke gennemføres");
    } finally {
      setBulkSaving(false);
    }
  }

  async function findOwnerSuggestion() {
    if (!detail || findingOwner) return;
    const contractId = detail.contract.id;
    const requestId = ++findOwnerRequestRef.current;
    setFindingOwner(true);
    try {
      const result = await findOwnersForContracts([contractId]);
      if (!result.success) throw new Error(result.error ?? "Ejerforslaget kunne ikke findes");
      if (requestId !== findOwnerRequestRef.current) return;
      if (result.matched > 0) toast.success("Ejerforslaget er opdateret");
      else if (result.skipped > 0) toast.info("Ejerskabskontrollen er allerede afgjort og blev ikke ændret");
      else toast.info("Der blev ikke fundet et sikkert ejerforslag");
      await openDetail(contractId);
      await loadPage();
    } catch (error) {
      if (requestId !== findOwnerRequestRef.current) return;
      toast.error(error instanceof Error ? error.message : "Ejerforslaget kunne ikke findes");
    } finally {
      if (requestId === findOwnerRequestRef.current) setFindingOwner(false);
    }
  }

  async function searchOwners() {
    const query = ownerSearch.trim();
    if (query.length < 2) {
      toast.error("Skriv mindst 2 tegn for at søge");
      return;
    }
    const requestId = ++ownerSearchRequestRef.current;
    setOwnerSearchLoading(true);
    setOwnerSearchPerformed(true);
    try {
      const result = await searchEligibleContractOwners(query);
      if (!result.success) throw new Error(result.error);
      if (requestId !== ownerSearchRequestRef.current) return;
      setOwnerCandidates(result.candidates);
    } catch (error) {
      if (requestId !== ownerSearchRequestRef.current) return;
      setOwnerCandidates([]);
      toast.error(error instanceof Error ? error.message : "Rettighedshavere kunne ikke søges");
    } finally {
      if (requestId === ownerSearchRequestRef.current) setOwnerSearchLoading(false);
    }
  }

  async function applyDecision() {
    if (!detail || !pendingDecision) return;
    setDecisionSaving(true);
    try {
      const result = await reviewContractOwnerVerification({
        contractId: detail.contract.id,
        expectedRightsHolderId: detail.assignedRightsHolder?.id ?? null,
        expectedRevision: detail.verification.revision,
        decision: pendingDecision.decision,
        newRightsHolderId: pendingDecision.nextOwner?.id ?? null,
        reasonCode: pendingDecision.decision === "blocked" ? normalizeContractOwnerBlockReason(blockReason) : pendingDecision.decision === "reassign" ? "admin_verified_correction" : "admin_verified_existing_owner",
      });
      if (!result.success) throw new Error(result.error);
      toast.success(pendingDecision.decision === "reassign" ? "Kontraktens ejer er rettet" : pendingDecision.decision === "blocked" ? "Ejerskabskontrollen er blokeret" : "Kontraktens ejer er bekræftet");
      setPendingDecision(null);
      await openDetail(detail.contract.id);
      await loadPage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ejerskabskontrollen kunne ikke gemmes");
    } finally {
      setDecisionSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return <div className="space-y-4">
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Kontrollér kontraktens rettighedshaver</p><p>AI og importkilder vises kun som forslag. Et ejerskifte sker først efter en bevidst administratorbeslutning og bliver auditlogget.</p></div></div>
    </div>

    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(220px,1fr)_190px_210px_auto] sm:items-center">
      <Input
        value={search}
        onChange={event => setSearch(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") submitSearch(); }}
        placeholder="Søg titel eller rettighedshaver…"
        aria-label="Søg i ejerskabskontrollen"
      />
      <Select value={status} onValueChange={value => { setStatus(value as ContractOwnerVerificationStatus | "all"); setPage(1); }}>
        <SelectTrigger aria-label="Filtrér på kontrolstatus"><SelectValue placeholder="Alle statusser" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Alle statusser</SelectItem>{STATUS_OPTIONS.map(value => <SelectItem key={value} value={value}>{contractOwnerStatusLabel(value)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={origin} onValueChange={value => { setOrigin(value as ContractOwnerAssignmentOrigin | "all"); setPage(1); }}>
        <SelectTrigger aria-label="Filtrér på oprindelse"><SelectValue placeholder="Alle oprindelser" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Alle oprindelser</SelectItem>{ORIGIN_OPTIONS.map(value => <SelectItem key={value} value={value}>{contractOwnerOriginLabel(value)}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" variant="outline" onClick={submitSearch} disabled={loading} aria-label={loading ? "Søger i ejerskabskontrollen" : "Søg i ejerskabskontrollen"}>{loading ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Søger…</span></> : "Søg"}</Button>
    </div>

    <ListResultSummary filteredCount={total} totalCount={total} selectedCount={selectedCount} loading={loading} />

    {selectedCount > 0 ? <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-medium">{selectedCount} valgt</p><p className="text-xs text-muted-foreground">{ownerSuggestionEligible.length} kan søges efter forslag for · {bulkConfirmEligible.length} kan bekræftes sikkert samlet. Konflikter skal åbnes enkeltvis.</p></div>
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end"><Button className="w-full sm:w-auto" variant="outline" onClick={() => setSelected(new Set())} disabled={loading || bulkBusy}>Ryd valg</Button><Button className="w-full sm:w-auto" variant="outline" disabled={loading || bulkBusy || ownerSuggestionBatch.length === 0} onClick={() => void findOwnerSuggestionsForSelected()}>{bulkFindingOwners ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}{bulkFindingOwners ? "Finder forslag…" : `Find ejerforslag (${ownerSuggestionBatch.length})`}</Button><Button className="w-full sm:w-auto" disabled={loading || bulkBusy || bulkConfirmEligible.length === 0} onClick={() => setBulkOpen(true)}><UserRoundCheck className="mr-2 h-4 w-4" />Bekræft sikre valg ({Math.min(bulkConfirmEligible.length, MAX_UI_BULK_CONFIRM)})</Button></div>
    </div> : null}

    <div className="hidden overflow-hidden rounded-lg border md:block" aria-busy={loading}>
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="w-10 p-3"><input className="h-5 w-5" type="checkbox" checked={allSelectableSelected} disabled={loading || bulkBusy || selectableOnPage.length === 0} onChange={toggleSelectablePage} aria-label="Vælg alle ejerskabskontroller, der kan søges efter ejerforslag for, på siden" /></th><th className="p-3">Kontrakt</th><th className="p-3">Nuværende ejer</th><th className="p-3">Forslag</th><th className="p-3">Status og oprindelse</th><th className="w-12 p-3"><span className="sr-only">Åbn</span></th></tr></thead>
        <tbody className="divide-y">{items.map(item => <tr key={item.contractId} className="hover:bg-muted/30">
          <td className="p-3"><input className="h-5 w-5" type="checkbox" checked={selected.has(item.contractId)} disabled={loading || bulkBusy || !canRequestOwnerSuggestion(item)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(item.contractId)) next.delete(item.contractId); else next.add(item.contractId); return next; })} aria-label={`Vælg ${item.workingTitle ?? "kontrakt"}`} /></td>
          <td className="p-3"><button type="button" disabled={loading || bulkBusy} onClick={() => void openDetail(item.contractId)} className="text-left disabled:pointer-events-none disabled:opacity-50"><span className="block font-medium hover:underline">{item.workingTitle ?? "Kontrakt uden titel"}</span><span className="mt-1 flex flex-wrap gap-1"><VersionBadge item={item} />{item.aiEvidenceAvailable ? <Badge variant="outline" className="text-[10px]">AI-kilde</Badge> : null}{item.spatialEvidenceAvailable ? <Badge variant="outline" className="text-[10px]">Præcis kildeplacering</Badge> : null}</span></button></td>
          <td className="p-3"><OwnerSummaryText owner={item.assignedRightsHolder} emptyLabel="Ingen" /></td>
          <td className="p-3"><OwnerSummaryText owner={item.proposedRightsHolder} emptyLabel="Intet forslag" /></td>
          <td className="p-3"><div className="space-y-1"><OwnerStatusBadge status={item.verificationStatus} /><p className="text-xs text-muted-foreground">{contractOwnerOriginLabel(item.assignmentOrigin)}</p></div></td>
          <td className="p-3"><Button size="icon" variant="ghost" disabled={loading || bulkBusy} onClick={() => void openDetail(item.contractId)} aria-label={`Åbn ejerskabskontrol for ${item.workingTitle ?? "kontrakten"}`}><ChevronRight className="h-4 w-4" /></Button></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="space-y-2 md:hidden" aria-busy={loading}>{items.map(item => <article key={item.contractId} className="rounded-lg border p-3">
      <div className="flex items-start gap-3"><input className="mt-1 h-5 w-5" type="checkbox" checked={selected.has(item.contractId)} disabled={loading || bulkBusy || !canRequestOwnerSuggestion(item)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(item.contractId)) next.delete(item.contractId); else next.add(item.contractId); return next; })} aria-label={`Vælg ${item.workingTitle ?? "kontrakt"}`} /><button type="button" disabled={loading || bulkBusy} className="min-w-0 flex-1 text-left disabled:pointer-events-none disabled:opacity-50" onClick={() => void openDetail(item.contractId)}><span className="block font-semibold">{item.workingTitle ?? "Kontrakt uden titel"}</span><span className="mt-1 flex flex-wrap gap-1"><OwnerStatusBadge status={item.verificationStatus} /><VersionBadge item={item} /></span></button><Button size="icon" variant="ghost" disabled={loading || bulkBusy} onClick={() => void openDetail(item.contractId)} aria-label={`Åbn ejerskabskontrol for ${item.workingTitle ?? "kontrakten"}`}><ChevronRight className="h-4 w-4" /></Button></div>
      <dl className="mt-3 grid gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Nuværende ejer</dt><dd><OwnerSummaryText owner={item.assignedRightsHolder} emptyLabel="Ingen" /></dd></div><div><dt className="text-xs text-muted-foreground">Forslag</dt><dd><OwnerSummaryText owner={item.proposedRightsHolder} emptyLabel="Intet forslag" /></dd></div><div><dt className="text-xs text-muted-foreground">Oprindelse</dt><dd>{contractOwnerOriginLabel(item.assignmentOrigin)}</dd></div></dl>
    </article>)}</div>

    {!loading && items.length === 0 ? <div className="rounded-lg border p-10 text-center"><FileSearch className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Ingen kontrakter matcher filtrene</p><p className="text-sm text-muted-foreground">Prøv at rydde søgningen eller vælge en anden status.</p></div> : null}

    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">Side {page} af {totalPages}</span><div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="col-span-2 w-full sm:w-24" aria-label="Antal pr. side"><SelectValue /></SelectTrigger><SelectContent>{[20, 50, 100].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select><Button className="w-full sm:w-auto" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))}>Forrige</Button><Button className="w-full sm:w-auto" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage(current => current + 1)}>Næste</Button></div></div>

    <Dialog open={bulkOpen} onOpenChange={open => { if (!bulkSaving) setBulkOpen(open); }}><DialogContent><DialogHeader><DialogTitle>Bekræft ejere på {bulkBatch.length} kontrakt{bulkBatch.length === 1 ? "" : "er"}?</DialogTitle><DialogDescription>Kun kontrakter uden et modstridende ejerforslag er medtaget. Hver kontrakt kontrolleres igen på serveren, før bekræftelsen gemmes og auditlogges.{bulkConfirmEligible.length > MAX_UI_BULK_CONFIRM ? ` De resterende ${bulkConfirmEligible.length - MAX_UI_BULK_CONFIRM} kan behandles i næste omgang.` : ""}</DialogDescription></DialogHeader>{bulkSaving ? <p className="text-sm text-muted-foreground" aria-live="polite">Serveren kontrollerer {bulkBatch.length} kontrakt{bulkBatch.length === 1 ? "" : "er"}…</p> : null}<DialogFooter><Button variant="outline" disabled={bulkSaving} onClick={() => setBulkOpen(false)}>Annuller</Button><Button disabled={bulkSaving || bulkBatch.length === 0} onClick={() => void confirmSelected()}>{bulkSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Bekræft</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={detailOpen} onOpenChange={open => {
      setDetailOpen(open);
      if (!open) {
        detailRequestRef.current += 1;
        findOwnerRequestRef.current += 1;
        ownerSearchRequestRef.current += 1;
        setDetailLoading(false);
        setFindingOwner(false);
        setOwnerSearchLoading(false);
        setPendingDecision(null);
        setDetail(null);
        setSelectedOwner(null);
        setOwnerCandidates([]);
        syncContractInUrl(null);
      }
    }}><DialogContent className="max-h-[calc(100svh-1rem)] w-[calc(100%-1rem)] overflow-y-auto p-4 sm:max-w-3xl sm:p-6"><DialogHeader><DialogTitle>Ejerskabskontrol</DialogTitle><DialogDescription>Kontrollér den aktuelle tilknytning mod rå AI- og dokumentevidens. Et forslag ændrer aldrig ejeren automatisk.</DialogDescription></DialogHeader>
      {detailLoading ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">Henter ejerskabskontrol</span></div> : detail ? <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"><div><p className="font-semibold">{detail.contract.workingTitle ?? "Kontrakt uden titel"}</p><p className="text-xs text-muted-foreground">Senest kontrolleret: {formatTimestamp(detail.verification.reviewedAt)}</p></div><OwnerStatusBadge status={detail.verification.status} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Nuværende rettighedshaver</p><p className="font-medium">{detail.assignedRightsHolder?.name ?? "Ingen tilknyttet"}</p>{detail.assignedRightsHolder?.secondaryLabel ? <p className="text-xs text-muted-foreground">{detail.assignedRightsHolder.secondaryLabel}</p> : null}</div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Foreslået rettighedshaver</p><p className="font-medium">{detail.proposedRightsHolder?.name ?? "Intet forslag"}</p>{detail.proposedRightsHolder?.secondaryLabel ? <p className="text-xs text-muted-foreground">{detail.proposedRightsHolder.secondaryLabel}</p> : null}{canRequestOwnerSuggestion({ verificationStatus: detail.verification.status, reasonCode: detail.verification.reasonCode }) ? <Button type="button" variant="outline" size="sm" className="mt-3 w-full" disabled={findingOwner || decisionSaving} onClick={() => void findOwnerSuggestion()}>{findingOwner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}{findingOwner ? "Søger efter forslag…" : "Find ejerforslag"}</Button> : null}</div></div>
        <div className="rounded-lg border p-3">
          <p className="text-sm font-semibold">Dokumentgrundlag</p>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-xs text-muted-foreground">Oprindelse</span><p>{contractOwnerOriginLabel(detail.verification.assignmentOrigin)}</p></div>
            <div><span className="text-xs text-muted-foreground">Dokumentbehandling</span><p>{documentProcessingLabel(detail.contract.documentProcessingStatus)}{detail.contract.documentProcessingErrorCode ? " · kræver kontrol" : ""}</p></div>
            <div><span className="text-xs text-muted-foreground">Original</span><p>{detail.contract.hasOriginal ? "Ja" : "Nej"}</p></div>
            <div><span className="text-xs text-muted-foreground">Behandlet PDF</span><p>{detail.contract.hasProcessed ? "Ja" : "Nej"}</p></div>
            <div><span className="text-xs text-muted-foreground">Version</span><p>{detail.contract.isCurrentVersion ? "Aktuel" : `Tidligere version ${detail.contract.versionIndex}`} · {detail.contract.versionCount} i alt</p></div>
          </div>
        </div>
        <div className="rounded-lg border p-3"><p className="text-sm font-semibold">Rå AI-evidens</p>{detail.aiEvidence ? <div className="mt-2 space-y-2 text-sm"><p><span className="text-muted-foreground">Udlæst navn:</span> {detail.aiEvidence.extractedRightsHolderName ?? "Ikke fundet"}</p>{detail.aiEvidence.sourceQuote ? <blockquote className="rounded border-l-4 bg-muted/40 p-3 text-sm">{detail.aiEvidence.sourceQuote}</blockquote> : <p className="text-muted-foreground">Ingen dokumenttekst er registreret som kilde.</p>}</div> : <p className="mt-2 text-sm text-muted-foreground">Der findes ingen rå AI-evidens for ejeren.</p>}</div>
        <div className="rounded-lg border p-3"><p className="text-sm font-semibold">Geometrisk kildeplacering</p>{detail.documentEvidence?.spatialEvidence ? <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">Side</dt><dd>{detail.documentEvidence.spatialEvidence.page}</dd></div><div><dt className="text-xs text-muted-foreground">Sikkerhed</dt><dd>{Math.round(detail.documentEvidence.spatialEvidence.confidence * 100)} %</dd></div><div><dt className="text-xs text-muted-foreground">Koordinatkilde</dt><dd>{coordinateSourceLabel(detail.documentEvidence.spatialEvidence.coordinateSource)}</dd></div></dl> : <p className="mt-2 text-sm text-muted-foreground">Der findes ikke en præcis kildeplacering til ejeroplysningen.</p>}</div>
        <div className="space-y-4 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="verified-owner-search">Korrekt rettighedshaver</Label>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void searchOwners(); }}>
              <Input
                id="verified-owner-search"
                value={ownerSearch}
                onChange={event => {
                  ownerSearchRequestRef.current += 1;
                  setOwnerSearch(event.target.value);
                  setOwnerCandidates([]);
                  setOwnerSearchLoading(false);
                  setOwnerSearchPerformed(false);
                }}
                placeholder="Søg navn eller medlemsnummer…"
                autoComplete="off"
                aria-describedby="verified-owner-help"
              />
              <Button type="submit" variant="outline" className="w-full shrink-0 sm:w-auto" disabled={ownerSearchLoading || ownerSearch.trim().length < 2}>
                {ownerSearchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Søg
              </Button>
            </form>
            <p id="verified-owner-help" className="text-xs text-muted-foreground">Søgningen viser højst 20 aktive profiler i den valgte organisation.</p>
            {ownerCandidates.length > 0 ? <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1" aria-label="Fundne rettighedshavere">
              {ownerCandidates.map(owner => <li key={owner.id}>
                <button
                  type="button"
                  aria-pressed={selectedOwner?.id === owner.id}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
                  onClick={() => setSelectedOwner(owner)}
                >
                  <span className="min-w-0 break-words">{contractOwnerOptionLabel(owner, ownerCandidates)}</span>
                  {selectedOwner?.id === owner.id ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> : null}
                </button>
              </li>)}
            </ul> : ownerSearchPerformed && !ownerSearchLoading ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Ingen aktive rettighedshavere matcher søgningen.</p> : null}
            {selectedOwner ? <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Valgt profil</p>
              <p className="font-medium">{selectedOwner.name}</p>
              {selectedOwner.secondaryLabel ? <p className="text-xs text-muted-foreground">{selectedOwner.secondaryLabel}</p> : null}
              <Link className="mt-2 inline-flex min-h-9 items-center text-xs font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/admin/rettighedshavere?edit=${encodeURIComponent(selectedOwner.id)}`} target="_blank" rel="noreferrer">Åbn profilen i en ny fane</Link>
            </div> : null}
          </div>
          <div><Label htmlFor="block-reason">Årsag, hvis sagen blokeres</Label><Select value={blockReason} onValueChange={setBlockReason}><SelectTrigger id="block-reason" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual_review_required">Kræver manuel dokumentkontrol</SelectItem><SelectItem value="missing_evidence">Mangler tilstrækkelig evidens</SelectItem><SelectItem value="evidence_conflict">Modstridende oplysninger</SelectItem><SelectItem value="inactive_profile">Profilen er inaktiv eller arkiveret</SelectItem><SelectItem value="wrong_organization">Profilen tilhører ikke organisationen</SelectItem></SelectContent></Select></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3"><Button variant="outline" disabled={!detail.assignedRightsHolder} onClick={() => detail.assignedRightsHolder && setPendingDecision({ decision: "confirm", nextOwner: detail.assignedRightsHolder })}>Bekræft nuværende</Button><Button disabled={!selectedOwner || selectedOwner.id === detail.assignedRightsHolder?.id} onClick={() => selectedOwner && setPendingDecision({ decision: "reassign", nextOwner: selectedOwner })}>Ret ejer</Button><Button variant="destructive" onClick={() => setPendingDecision({ decision: "blocked", nextOwner: null })}>Blokér kontrol</Button></div>
        <Button asChild variant="ghost" className="w-full"><Link href={`/admin/kontrakter/${encodeURIComponent(detail.contract.id)}/rediger?returnTo=${encodeURIComponent(`/admin/kontrakter?tab=ejerskabskontrol&contractId=${detail.contract.id}`)}`}>Åbn kontrakt og kilder</Link></Button>
      </div> : null}
    </DialogContent></Dialog>

    <Dialog open={Boolean(pendingDecision)} onOpenChange={open => { if (!open && !decisionSaving) setPendingDecision(null); }}><DialogContent><DialogHeader><DialogTitle>{pendingDecision?.decision === "reassign" ? "Ret kontraktens ejer?" : pendingDecision?.decision === "blocked" ? "Blokér ejerskabskontrollen?" : "Bekræft den nuværende ejer?"}</DialogTitle><DialogDescription>{pendingDecision?.decision === "reassign" ? `Ejeren ændres fra ${detail?.assignedRightsHolder?.name ?? "ingen"} til ${pendingDecision.nextOwner?.name}. En valideret kontrakt genåbnes som kladde, og afsnitsbekræftelser ugyldiggøres. Værkets krediteringer flyttes ikke.` : pendingDecision?.decision === "blocked" ? "Kontrakten ændrer ikke ejer. Sagen bliver stående til manuel opfølgning." : "Den eksisterende tilknytning bekræftes. Serveren kontrollerer, at ingen har ændret kontrakten siden åbningen."}</DialogDescription></DialogHeader>{pendingDecision?.decision === "reassign" ? <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Der sendes ikke automatisk mail. Ejerskiftet og den ansvarlige administrator bliver auditlogget.</p></div> : null}<DialogFooter><Button variant="outline" disabled={decisionSaving} onClick={() => setPendingDecision(null)}>Annuller</Button><Button variant={pendingDecision?.decision === "blocked" ? "destructive" : "default"} disabled={decisionSaving} onClick={() => void applyDecision()}>{decisionSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gem beslutning</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
