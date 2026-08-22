"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileText, RotateCcw, Search, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { DbContractReview } from "@/lib/db/types";
import { isActiveContractReviewAnalysis, normalizeContractReviewAnalysisStatus } from "@/lib/contract-review-job-status";
import { useI18n } from "@/lib/i18n";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";
import { ListResultSummary } from "@/components/list-result-summary";
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABELS: Record<string, { da: string; en: string }> = {
  afventer: { da: "Ikke tildelt", en: "Unassigned" },
  behandling: { da: "Under behandling", en: "In progress" },
  afsluttet: { da: "Afsluttet", en: "Completed" },
};

function analysisState(review: DbContractReview) {
  return review.analysis_status ?? normalizeContractReviewAnalysisStatus({
    aiStatus: review.ai_status,
    intakeStatus: review.intake_status,
    job: review.analysis_job ? {
      status: review.analysis_job.status,
      attempts: review.analysis_job.attempts,
      next_attempt_at: review.analysis_job.next_attempt_at,
      error_message: review.analysis_job.error,
    } : null,
  });
}

function relativeTime(value: string, locale: "da" | "en") {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale === "da" ? "da-DK" : "en-GB", { numeric: "auto" });
  if (minutes < 60) return formatter.format(-Math.max(0, minutes), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

export type ContractReviewQueueInitialData = {
  data: DbContractReview[];
  count: number;
  orgId: string | null;
};

export function ContractReviewQueue({ initialData }: { initialData?: ContractReviewQueueInitialData }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [queue, setQueue] = useState(searchParams.get("queue") === "mine" ? "mine" : "all");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [productionType, setProductionType] = useState(searchParams.get("productionType") ?? "all");
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get("page")) || 1));
  const [pageSize, setPageSize] = useState([20, 50, 100].includes(Number(searchParams.get("limit"))) ? Number(searchParams.get("limit")) : 20);
  const [reviews, setReviews] = useState<DbContractReview[]>(initialData?.data ?? []);
  const [count, setCount] = useState(initialData?.count ?? 0);
  const [orgId, setOrgId] = useState<string | null>(initialData?.orgId ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const requestId = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const skipInitialRequest = useRef(Boolean(initialData));

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (showLoading = true) => {
    const id = ++requestId.current;
    if (showLoading) setLoading(true);
    const params = new URLSearchParams({ queue, page: String(page), limit: String(pageSize) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status !== "all") params.set("status", status);
    if (productionType !== "all") params.set("productionType", productionType);
    try {
      const response = await fetch(`/api/admin/contracts?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Kunne ikke hente kontrakter");
      if (id !== requestId.current) return;
      setReviews(result.data ?? []);
      setCount(result.count ?? 0);
      setOrgId(result.orgId ?? null);
    } catch (error) {
      if (id === requestId.current) toast.error(error instanceof Error ? error.message : "Kunne ikke hente kontrakter");
    } finally {
      if (showLoading && id === requestId.current) setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, productionType, queue, status]);

  useEffect(() => {
    if (skipInitialRequest.current) { skipInitialRequest.current = false; return; }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (queue === "mine") params.set("queue", "mine");
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status !== "all") params.set("status", status);
    if (productionType !== "all") params.set("productionType", productionType);
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 20) params.set("limit", String(pageSize));
    router.replace(`/admin/kontraktgennemgang${params.size ? `?${params}` : ""}`, { scroll: false });
  }, [debouncedSearch, page, pageSize, productionType, queue, router, status]);
  useEffect(() => {
    if (!reviews.some(review => isActiveContractReviewAnalysis(analysisState(review)))) return;
    const timer = window.setInterval(() => void load(false), 5_000);
    return () => window.clearInterval(timer);
  }, [load, reviews]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => { refreshTimer.current = null; void load(false); }, 250);
  }, [load]);
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    const channel = supabase.channel(`contract_reviews_changes:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contract_reviews", filter: `org_id=eq.${orgId}` }, scheduleRefresh)
      .subscribe();
    return () => { if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current); void supabase.removeChannel(channel); };
  }, [orgId, scheduleRefresh]);

  const visibleIds = reviews.map(review => review.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(current => allSelected ? new Set([...current].filter(id => !visibleIds.includes(id))) : new Set([...current, ...visibleIds]));

  const bulk = async (action: "claim" | "release" | "complete") => {
    if (!selected.size) return;
    setBusy(true);
    const body = action === "complete" ? { status: "afsluttet" } : { action };
    const results = await Promise.all([...selected].map(id => fetch(`/api/admin/contracts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })));
    const failed = results.filter(response => !response.ok).length;
    if (failed) toast.error(`${failed} kunne ikke opdateres`);
    else toast.success(`${results.length} blev opdateret`);
    setSelected(new Set());
    await load(false);
    setBusy(false);
  };

  const removeSelected = async () => {
    setBusy(true);
    const response = await fetch("/api/admin/contracts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...selected] }) });
    const result = await response.json();
    if (!response.ok) toast.error(result.error ?? "Sletning fejlede");
    else { toast.success(`${result.deletedIds?.length ?? 0} blev slettet`); setSelected(new Set()); setDeleteOpen(false); await load(false); }
    setBusy(false);
  };

  const reanalyse = async (id: string) => {
    const response = await fetch(`/api/admin/contracts/${id}/reanalyse`, { method: "POST" });
    if (response.ok) toast.success("Analysen er sat i kø");
    else toast.error("Analysen kunne ikke sættes i kø");
    await load(false);
  };

  const analysisBadge = (review: DbContractReview) => {
    const value = analysisState(review);
    const labels = { queued: { da: "I kø", en: "Queued" }, processing: { da: "Analyserer", en: "Analysing" }, retrying: { da: "Prøver igen", en: "Retrying" }, failed: { da: "Analyse fejlede – genprøv", en: "Analysis failed – retry" }, ready: { da: "Analyse klar", en: "Analysis ready" } } as const;
    if (value === "failed") return <button type="button" className="text-xs text-destructive underline" onClick={event => { event.stopPropagation(); void reanalyse(review.id); }}>{labels[value][locale]}</button>;
    return <Badge variant="outline">{value === "processing" && <RotateCcw className="mr-1 h-3 w-3 animate-spin" />}{value === "ready" && <CheckCircle2 className="mr-1 h-3 w-3" />}{labels[value][locale]}</Badge>;
  };

  return <div className="space-y-4">
    <div className="flex gap-2 border-b">
      <Button type="button" variant={queue === "all" ? "default" : "ghost"} size="sm" onClick={() => { setQueue("all"); setPage(1); }}>Alle</Button>
      <Button type="button" variant={queue === "mine" ? "default" : "ghost"} size="sm" onClick={() => { setQueue("mine"); setPage(1); }}>Min kø</Button>
    </div>
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <div className="relative flex-1 sm:max-w-xs"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder={t("admin.reviewQueue.search")} /></div>
      <Select value={status} onValueChange={value => { setStatus(value); setPage(1); }}><SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle statusser</SelectItem><SelectItem value="afventer">Ikke tildelt</SelectItem><SelectItem value="behandling">Under behandling</SelectItem><SelectItem value="afsluttet">Afsluttet</SelectItem></SelectContent></Select>
      <Select value={productionType} onValueChange={value => { setProductionType(value); setPage(1); }}><SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle produktionstyper</SelectItem><SelectItem value="dokumentar">Dokumentarfilm</SelectItem><SelectItem value="spillefilm">Spillefilm</SelectItem><SelectItem value="tvserie">TV-serie</SelectItem><SelectItem value="kortfilm">Kortfilm</SelectItem><SelectItem value="reklame">Reklame</SelectItem></SelectContent></Select>
    </div>
    <Button type="button" variant="outline" className="w-full md:hidden" onClick={toggleAll} disabled={!reviews.length}>{allSelected ? "Fravælg alle viste" : "Vælg alle viste"}</Button>
    <ListResultSummary filteredCount={count} totalCount={count} selectedCount={selected.size} loading={loading} />
    {!loading && <ListReadinessMarker route="contract-reviews" stage={reviews.length ? "first-row" : "primary"} />}
    {selected.size > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3"><span>{selected.size} valgt</span><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk("claim")}>Tildel valgte til mig</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk("release")}>Frigiv valgte</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk("complete")}>Markér afsluttet</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 className="mr-1 h-4 w-4" />Slet valgte</Button></div></div>}
    <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Sagsstatus viser, hvem der har ansvaret. AI-status viser kun, om kontrakten er aflæst. Tildeling starter ikke analyse og afslutter ikke sagen.</p>
    {loading ? <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Indlæser…</div> : reviews.length === 0 ? <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Ingen kontraktgennemgange</div> : <>
      <MobileCardList>{reviews.map(review => <MobileDataCard key={review.id}><div className="flex gap-3"><input type="checkbox" checked={selected.has(review.id)} onChange={() => toggle(review.id)} aria-label={`Vælg ${review.file_name ?? "kontrakt"}`} /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => router.push(`/admin/kontraktgennemgang/${review.id}`)}><strong className="block truncate">{review.member_name ?? "Ukendt"}</strong><span className="block truncate text-sm text-muted-foreground">{review.file_name ?? "–"}</span></button>{analysisBadge(review)}</div><div className="mt-3 grid grid-cols-2 gap-2"><MobileMetaRow label="Modtaget">{relativeTime(review.reviewed_at, locale)}</MobileMetaRow><MobileMetaRow label="Status">{STATUS_LABELS[review.status]?.[locale] ?? review.status}</MobileMetaRow></div></MobileDataCard>)}</MobileCardList>
      <ResponsiveTableFrame><table className="w-full text-xs"><thead><tr className="border-b bg-muted/30"><th className="w-10 p-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Vælg alle viste" /></th><th className="p-3 text-left">Modtaget</th><th className="p-3 text-left">Rettighedshaver</th><th className="p-3 text-left">Fil</th><th className="p-3 text-left">Producent</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Ansvarlig</th></tr></thead><tbody className="divide-y">{reviews.map(review => <tr key={review.id}><td className="p-3"><input type="checkbox" checked={selected.has(review.id)} onChange={() => toggle(review.id)} aria-label={`Vælg ${review.file_name ?? "kontrakt"}`} /></td><td className="p-3 whitespace-nowrap">{relativeTime(review.reviewed_at, locale)}</td><td className="p-3"><button type="button" className="flex items-center gap-1 hover:underline" onClick={() => router.push(`/admin/kontraktgennemgang/${review.id}`)}><User className="h-3 w-3" />{review.member_name ?? "Ukendt"}</button></td><td className="max-w-48 truncate p-3"><FileText className="mr-1 inline h-3 w-3" />{review.file_name ?? "–"}</td><td className="p-3">{review.producer_name ?? "–"}</td><td className="p-3"><div className="flex gap-2"><Badge variant="outline">{STATUS_LABELS[review.status]?.[locale] ?? review.status}</Badge>{analysisBadge(review)}</div></td><td className="p-3">{review.assigned_to_name ?? "–"}</td></tr>)}</tbody></table></ResponsiveTableFrame>
      <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-muted-foreground">Side {page} af {Math.max(1, Math.ceil(count / pageSize))}</span><div className="flex gap-2"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[20, 50, 100].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Forrige</Button><Button size="sm" variant="outline" disabled={page * pageSize >= count} onClick={() => setPage(value => value + 1)}>Næste</Button></div></div>
    </>}
    {!loading && <ListReadinessMarker route="contract-reviews" stage="complete" />}
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>Slet valgte kontraktgennemgange?</DialogTitle><DialogDescription>Reviewfiler og analyse slettes permanent. Tilknyttede kontrakter i Kontraktadmin bevares.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Annuller</Button><Button variant="destructive" disabled={busy} onClick={() => void removeSelected()}>Slet permanent</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
