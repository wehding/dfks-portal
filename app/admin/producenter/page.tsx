"use client";

import { Fragment, useEffect, useState } from "react";
import { Building2, ChevronDown, ChevronRight, FileText, Film, Loader2, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view";
import { TableSkeleton } from "@/components/ui/data-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Producer = { id: string; name: string; parent_name: string | null; status: "attention" | "active" | "inactive"; work_count: number; contract_count: number; latest_activity: string | null };
type RightsHolder = { id: string; full_name: string };
type WorkDetail = { id: string; title: string; type: string; year: number | null; status: string };
type ContractDetail = { id: string; working_title: string | null; type: string; status: string; contract_date: string | null; created_at: string; rettighedshavere: { full_name: string | null } | Array<{ full_name: string | null }> | null };
type DetailState = { loading: boolean; error: string | null; rows: Array<WorkDetail | ContractDetail> };
type DetailType = "works" | "contracts";

const statusTone = { attention: "border-amber-300 bg-amber-100 text-amber-800", active: "border-emerald-300 bg-emerald-100 text-emerald-800", inactive: "border-border bg-muted text-muted-foreground" };

export default function ProducersPage() {
  const { t, locale } = useI18n();
  const [producers, setProducers] = useState<Producer[]>([]);
  const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [rightsHolderId, setRightsHolderId] = useState("all");
  const [sort, setSort] = useState("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ sort, direction });
      if (query.trim()) params.set("query", query.trim());
      if (status !== "all") params.set("status", status);
      if (rightsHolderId !== "all") params.set("rightsHolderId", rightsHolderId);
      try {
        const response = await fetch(`/api/admin/producers?${params}`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setProducers(json.data ?? []); setRightsHolders(json.rightsHolders ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProducers([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, status, rightsHolderId, sort, direction]);

  const allSelected = producers.length > 0 && producers.every(producer => selected.includes(producer.id));
  const statusLabel = (value: Producer["status"]) => t(`admin.producers.status.${value}` as Parameters<typeof t>[0]);
  const detailKey = (id: string, type: DetailType) => `${id}:${type}`;
  const loadDetails = async (id: string, type: DetailType, force = false) => {
    const key = detailKey(id, type);
    if (!force && details[key]) return;
    setDetails(current => ({ ...current, [key]: { loading: true, error: null, rows: current[key]?.rows ?? [] } }));
    try {
      const response = await fetch(`/api/admin/producers/${id}?type=${type}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setDetails(current => ({ ...current, [key]: { loading: false, error: null, rows: json.data ?? [] } }));
    } catch (error) {
      setDetails(current => ({ ...current, [key]: { loading: false, error: error instanceof Error ? error.message : t("common.error"), rows: [] } }));
    }
  };
  const toggleDetail = (id: string, type: DetailType) => {
    const key = detailKey(id, type);
    setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    if (!open.has(key)) void loadDetails(id, type);
  };
  const toggleSelected = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const toggleAll = () => setSelected(allSelected ? [] : producers.map(producer => producer.id));
  const changeSort = (key: string) => { if (sort === key) setDirection(value => value === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } };
  const mark = (key: string) => sort === key ? (direction === "asc" ? " ↑" : " ↓") : "";

  const DetailPanel = ({ producer, type }: { producer: Producer; type: DetailType }) => {
    const key = detailKey(producer.id, type); const state = details[key];
    if (!open.has(key)) return null;
    return <div className="border-t bg-muted/20 p-4">
      {state?.loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</div>
        : state?.error ? <div className="flex items-center gap-2 text-sm text-destructive">{state.error}<Button size="sm" variant="outline" onClick={() => void loadDetails(producer.id, type, true)}>{t("common.retry")}</Button></div>
        : !state?.rows.length ? <p className="text-sm text-muted-foreground">{type === "works" ? t("admin.producers.noWorks") : t("admin.producers.noContracts")}</p>
        : <div className="space-y-2">{state.rows.map(row => type === "works" ? <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-sm"><span className="font-medium">{(row as WorkDetail).title}</span><span className="text-muted-foreground">{(row as WorkDetail).year ?? "—"} · {(row as WorkDetail).type}</span></div> : (() => { const contract = row as ContractDetail; const holder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere; return <div key={contract.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-sm"><span><span className="block font-medium">{contract.working_title ?? "—"}</span><span className="text-xs text-muted-foreground">{holder?.full_name ?? "—"}</span></span><Badge variant="outline">{contract.status}</Badge></div>; })())}</div>}
    </div>;
  };

  return <div className="space-y-6">
    <PageHeader title={t("admin.producers.title")} subtitle={t("admin.producers.subtitle")} />
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
      <div className="relative flex-1 lg:max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9 pr-9" placeholder={t("admin.producers.search")} />{query && <button type="button" aria-label={t("common.clearSearch")} onClick={() => setQuery("")} className="absolute right-3 top-2.5"><X className="h-4 w-4" /></button>}</div>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allStatuses")}</SelectItem><SelectItem value="attention">{statusLabel("attention")}</SelectItem><SelectItem value="active">{statusLabel("active")}</SelectItem><SelectItem value="inactive">{statusLabel("inactive")}</SelectItem></SelectContent></Select>
      <Select value={rightsHolderId} onValueChange={setRightsHolderId}><SelectTrigger className="w-full lg:w-60"><SelectValue placeholder={t("admin.producers.rightsHolder")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allRightsHolders")}</SelectItem>{rightsHolders.map(holder => <SelectItem key={holder.id} value={holder.id}>{holder.full_name}</SelectItem>)}</SelectContent></Select>
      <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full lg:hidden"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name">{t("admin.producers.producer")}</SelectItem><SelectItem value="works">{t("admin.producers.works")}</SelectItem><SelectItem value="contracts">{t("admin.producers.contracts")}</SelectItem><SelectItem value="latest">{t("admin.producers.latest")}</SelectItem></SelectContent></Select>
      <Button variant="outline" onClick={() => setDirection(value => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? "A–Z" : "Z–A"}</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={toggleAll}>{allSelected ? t("common.deselectAll") : t("common.selectAll")}</Button>{selected.length > 0 && <><span className="text-sm text-muted-foreground">{t("common.selectedCount", { count: selected.length })}</span><Button variant="ghost" size="sm" onClick={() => setSelected([])}>{t("common.clearSelection")}</Button></>}</div>

    {loading ? <TableSkeleton columns={7} rows={8} /> : <>
      <MobileCardList>{producers.length ? producers.map(producer => <MobileDataCard key={producer.id}><div className="flex items-start gap-3"><input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} /><Building2 className="h-4 w-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">{producer.name}</p><p className="text-sm text-muted-foreground">{producer.parent_name ?? "—"}</p></div><Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2"><MobileMetaRow label={t("admin.producers.works")}>{producer.work_count}</MobileMetaRow><MobileMetaRow label={t("admin.producers.contracts")}>{producer.contract_count}</MobileMetaRow></div><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => toggleDetail(producer.id, "works")}><Film className="mr-1 h-3.5 w-3.5" />{t("admin.producers.works")}</Button><Button size="sm" variant="outline" onClick={() => toggleDetail(producer.id, "contracts")}><FileText className="mr-1 h-3.5 w-3.5" />{t("admin.producers.contracts")}</Button></div><DetailPanel producer={producer} type="works" /><DetailPanel producer={producer} type="contracts" /></MobileDataCard>) : <MobileDataCard><p className="py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</p></MobileDataCard>}</MobileCardList>
      <ResponsiveTableFrame><Table><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("common.selectAll")} /></TableHead>{[["name","admin.producers.producer"],["parent","admin.producers.parent"],["status","common.status"],["works","admin.producers.works"],["contracts","admin.producers.contracts"],["latest","admin.producers.latest"]].map(([key,label]) => <TableHead key={key}><button type="button" onClick={() => changeSort(key)}>{t(label as Parameters<typeof t>[0])}{mark(key)}</button></TableHead>)}</TableRow></TableHeader><TableBody>{producers.length ? producers.map(producer => <Fragment key={producer.id}><TableRow><TableCell><input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} /></TableCell><TableCell className="font-medium">{producer.name}</TableCell><TableCell>{producer.parent_name ?? "—"}</TableCell><TableCell><Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge></TableCell><TableCell><button type="button" className="flex items-center gap-1" onClick={() => toggleDetail(producer.id, "works")}>{open.has(detailKey(producer.id,"works")) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{producer.work_count}</button></TableCell><TableCell><button type="button" className="flex items-center gap-1" onClick={() => toggleDetail(producer.id, "contracts")}>{open.has(detailKey(producer.id,"contracts")) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{producer.contract_count}</button></TableCell><TableCell>{producer.latest_activity ? new Date(producer.latest_activity).toLocaleDateString(locale === "da" ? "da-DK" : "en-GB") : "—"}</TableCell></TableRow>{open.has(detailKey(producer.id,"works")) && <TableRow><TableCell colSpan={7} className="p-0"><DetailPanel producer={producer} type="works" /></TableCell></TableRow>}{open.has(detailKey(producer.id,"contracts")) && <TableRow><TableCell colSpan={7} className="p-0"><DetailPanel producer={producer} type="contracts" /></TableCell></TableRow>}</Fragment>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("common.noResults")}</TableCell></TableRow>}</TableBody></Table></ResponsiveTableFrame>
    </>}
  </div>;
}
