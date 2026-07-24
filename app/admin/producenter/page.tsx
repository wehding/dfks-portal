"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, ChevronRight, FileText, Film, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view";
import { TableSkeleton } from "@/components/ui/data-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LegalEntitySummary = { id: string; legal_name: string; registration_country: string; registration_type: string; registration_number: string | null; entity_kind: string; is_primary: boolean; registration_status: string | null; address?: string | null; contact_phone?: string | null; contact_email?: string | null; website?: string | null; industry_code?: string | null; industry_description?: string | null; company_type?: string | null };
type Producer = { id: string; name: string; dfi_company_id: number | null; parent_name: string | null; status: "attention" | "active" | "inactive"; work_count: number; contract_count: number; latest_activity: string | null; legal_entities: LegalEntitySummary[]; aliases: string[] };
type RightsHolder = { id: string; full_name: string };
type WorkDetail = { id: string; title: string; type: string; year: number | null; status: string };
type ContractDetail = { id: string; working_title: string | null; type: string; status: string; contract_date: string | null; created_at: string; rettighedshavere: { full_name: string | null } | Array<{ full_name: string | null }> | null };
type DetailState = { loading: boolean; error: string | null; rows: Array<WorkDetail | ContractDetail | LegalEntitySummary> };
type DetailType = "works" | "contracts" | "legal_entities";
type LegalEntityDraft = { id?: string; legalName: string; registrationNumber: string; address: string; contactPhone: string; contactEmail: string; website: string; registrationStatus: string; industryCode: string; industryDescription: string; companyType: string; isPrimary: boolean };
type ProducerDraft = { id?: string; name: string; dfiCompanyId: string; legalEntities: LegalEntityDraft[] };
type CvrSearchResult = { name: string; cvrNumber: string; industryCode: string | null; industryDescription: string | null; score?: number };

const emptyLegalEntity = (): LegalEntityDraft => ({ legalName: "", registrationNumber: "", address: "", contactPhone: "", contactEmail: "", website: "", registrationStatus: "", industryCode: "", industryDescription: "", companyType: "", isPrimary: false });

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
  const [merging, setMerging] = useState(false);
  const [canMerge, setCanMerge] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<ProducerDraft | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [dfiSearching, setDfiSearching] = useState(false);
  const [dfiResults, setDfiResults] = useState<Array<{ id: string; name: string }>>([]);
  const [cvrLoadingIndex, setCvrLoadingIndex] = useState<number | null>(null);
  const [cvrQuery, setCvrQuery] = useState("");
  const [cvrSearching, setCvrSearching] = useState(false);
  const [cvrResults, setCvrResults] = useState<CvrSearchResult[]>([]);

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
        setProducers(json.data ?? []); setRightsHolders(json.rightsHolders ?? []); setCanMerge(Boolean(json.canMerge));
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProducers([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, status, rightsHolderId, sort, direction, refreshKey]);

  const openCreate = () => {
    setDfiResults([]);
    setCvrQuery("");
    setCvrResults([]);
    setEditor({ name: "", dfiCompanyId: "", legalEntities: [{ ...emptyLegalEntity(), isPrimary: true }] });
  };
  const openEdit = (producer: Producer) => {
    setDfiResults([]);
    setCvrQuery(producer.name);
    setCvrResults([]);
    setEditor({
      id: producer.id,
      name: producer.name,
      dfiCompanyId: producer.dfi_company_id ? String(producer.dfi_company_id) : "",
      legalEntities: producer.legal_entities.length ? producer.legal_entities.map(entity => ({
        id: entity.id,
        legalName: entity.legal_name,
        registrationNumber: entity.registration_number ?? "",
        address: entity.address ?? "",
        contactPhone: entity.contact_phone ?? "",
        contactEmail: entity.contact_email ?? "",
        website: entity.website ?? "",
        registrationStatus: entity.registration_status ?? "",
        industryCode: entity.industry_code ?? "",
        industryDescription: entity.industry_description ?? "",
        companyType: entity.company_type ?? "",
        isPrimary: entity.is_primary,
      })) : [{ ...emptyLegalEntity(), legalName: producer.name, isPrimary: true }],
    });
  };
  const updateLegalEntity = (index: number, values: Partial<LegalEntityDraft>) => setEditor(current => current ? ({
    ...current,
    legalEntities: current.legalEntities.map((entity, entityIndex) => entityIndex === index ? { ...entity, ...values } : entity),
  }) : current);
  const searchDfiCompanies = async () => {
    if (!editor?.name.trim()) return;
    setDfiSearching(true);
    try {
      const response = await fetch(`/api/dfi/search?q=${encodeURIComponent(editor.name.trim())}`);
      const json = await response.json();
      setDfiResults(response.ok ? json.results ?? [] : []);
    } finally { setDfiSearching(false); }
  };
  const lookupCvr = async (index: number) => {
    const cvr = editor?.legalEntities[index]?.registrationNumber.replace(/\D/g, "") ?? "";
    if (!/^\d{8}$/.test(cvr)) { toast.error("CVR skal bestå af 8 cifre"); return; }
    setCvrLoadingIndex(index);
    try {
      const response = await fetch(`/api/cvr?cvr=${cvr}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      updateLegalEntity(index, {
        legalName: json.legalName ?? "",
        registrationNumber: json.registrationNumber ?? cvr,
        address: json.address ?? "",
        contactPhone: json.contactPhone ?? "",
        contactEmail: json.contactEmail ?? "",
        website: json.website ?? "",
        registrationStatus: json.status ?? "",
        industryCode: json.industryCode ?? "",
        industryDescription: json.industryDescription ?? "",
        companyType: json.companyType ?? "",
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : "CVR kunne ikke hentes"); }
    finally { setCvrLoadingIndex(null); }
  };
  const searchCvrCompanies = async () => {
    const query = cvrQuery.trim() || editor?.name.trim() || "";
    if (query.length < 2) { toast.error("Skriv et CVR-nummer eller mindst 2 tegn af navnet"); return; }
    setCvrSearching(true);
    try {
      const response = await fetch(`/api/cvr?q=${encodeURIComponent(query)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setCvrResults(json.results ?? []);
      if (!(json.results ?? []).length) toast.info("Ingen virksomheder fundet i CVR");
    } catch (error) { toast.error(error instanceof Error ? error.message : "CVR-søgning fejlede"); }
    finally { setCvrSearching(false); }
  };
  const selectCvrCompany = async (result: CvrSearchResult) => {
    if (!editor) return;
    setCvrSearching(true);
    try {
      const response = await fetch(`/api/cvr?cvr=${result.cvrNumber}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      const entity = {
        ...emptyLegalEntity(),
        legalName: json.legalName ?? result.name,
        registrationNumber: json.registrationNumber ?? result.cvrNumber,
        address: json.address ?? "",
        contactPhone: json.contactPhone ?? "",
        contactEmail: json.contactEmail ?? "",
        website: json.website ?? "",
        registrationStatus: json.status ?? "",
        industryCode: json.industryCode ?? result.industryCode ?? "",
        industryDescription: json.industryDescription ?? result.industryDescription ?? "",
        companyType: json.companyType ?? "",
      };
      const emptyIndex = editor.legalEntities.findIndex(row => !row.id && !row.registrationNumber && !row.legalName.trim());
      const legalEntities = emptyIndex >= 0
        ? editor.legalEntities.map((row, index) => index === emptyIndex ? { ...entity, isPrimary: row.isPrimary } : row)
        : [...editor.legalEntities, { ...entity, isPrimary: editor.legalEntities.length === 0 }];
      setEditor({ ...editor, name: editor.name.trim() || result.name, legalEntities });
      setCvrQuery(result.cvrNumber);
      setCvrResults([]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "CVR-data kunne ikke hentes"); }
    finally { setCvrSearching(false); }
  };
  const saveEditor = async () => {
    if (!editor?.name.trim()) return;
    setSavingEditor(true);
    try {
      const response = await fetch(editor.id ? `/api/admin/producers/${editor.id}` : "/api/admin/producers", {
        method: editor.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      toast.success(editor.id ? "Producenten blev opdateret" : "Producenten blev oprettet");
      setEditor(null);
      setRefreshKey(value => value + 1);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Producenten kunne ikke gemmes"); }
    finally { setSavingEditor(false); }
  };

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
  const mergeSelected = async () => {
    if (selected.length !== 2) return;
    const [sourceId, targetId] = selected;
    const source = producers.find(producer => producer.id === sourceId);
    const target = producers.find(producer => producer.id === targetId);
    if (!source || !target || !window.confirm(locale === "da"
      ? `Sammenlæg “${source.name}” ind i “${target.name}”? Alle CVR-numre, værker og kontrakter flyttes. Handlingen kan ikke fortrydes i brugerfladen.`
      : `Merge “${source.name}” into “${target.name}”? All registrations, works and contracts will move. This cannot be undone in the interface.`)) return;
    setMerging(true);
    try {
      const response = await fetch("/api/admin/producers/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setProducers(current => current.filter(producer => producer.id !== sourceId));
      setSelected([]);
      toast.success(locale === "da" ? "Selskaberne blev sammenlagt." : "The companies were merged.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally { setMerging(false); }
  };

  const DetailPanel = ({ producer, type }: { producer: Producer; type: DetailType }) => {
    const key = detailKey(producer.id, type); const state = details[key];
    if (!open.has(key)) return null;
    return <div className="border-t bg-muted/20 p-4">
      {state?.loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</div>
        : state?.error ? <div className="flex items-center gap-2 text-sm text-destructive">{state.error}<Button size="sm" variant="outline" onClick={() => void loadDetails(producer.id, type, true)}>{t("common.retry")}</Button></div>
        : !state?.rows.length ? <p className="text-sm text-muted-foreground">{type === "works" ? t("admin.producers.noWorks") : type === "contracts" ? t("admin.producers.noContracts") : t("admin.producers.noLegalEntities")}</p>
        : <div className="space-y-2">{state.rows.map(row => type === "works" ? (() => { const work = row as WorkDetail; return <Link href={`/admin/vaerker?edit=${work.id}`} key={work.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-sm hover:bg-muted/50"><span className="font-medium">{work.title}</span><span className="text-muted-foreground">{work.year ?? "—"} · {work.type}</span></Link>; })() : type === "contracts" ? (() => { const contract = row as ContractDetail; const holder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere; return <Link href={`/admin/kontrakter?edit=${contract.id}`} key={contract.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-sm hover:bg-muted/50"><span><span className="block font-medium">{contract.working_title ?? "—"}</span><span className="text-xs text-muted-foreground">{holder?.full_name ?? "—"}</span></span><Badge variant="outline">{contract.status}</Badge></Link>; })() : (() => { const entity = row as LegalEntitySummary; return <div key={entity.id} className="grid gap-1 rounded-md border bg-background p-3 text-sm sm:grid-cols-[1fr_auto]"><span><span className="block font-medium">{entity.legal_name}</span><span className="text-xs text-muted-foreground">{entity.entity_kind === "spv" ? "SPV" : entity.entity_kind === "subsidiary" ? t("admin.producers.subsidiary") : t("admin.producers.company")}{entity.registration_status ? ` · ${entity.registration_status}` : ""}</span></span><span className="text-muted-foreground">{entity.registration_number ? `${entity.registration_type} ${entity.registration_number}` : t("admin.producers.noRegistration")}{entity.is_primary ? ` · ${t("admin.producers.primary")}` : ""}</span></div>; })())}</div>}
    </div>;
  };

  return <div className="space-y-6">
    <PageHeader title={t("admin.producers.title")} subtitle={t("admin.producers.subtitle")} actions={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Tilføj producent</Button>} />
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
      <div className="relative flex-1 lg:max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9 pr-9" placeholder={t("admin.producers.search")} />{query && <button type="button" aria-label={t("common.clearSearch")} onClick={() => setQuery("")} className="absolute right-3 top-2.5"><X className="h-4 w-4" /></button>}</div>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allStatuses")}</SelectItem><SelectItem value="attention">{statusLabel("attention")}</SelectItem><SelectItem value="active">{statusLabel("active")}</SelectItem><SelectItem value="inactive">{statusLabel("inactive")}</SelectItem></SelectContent></Select>
      <Select value={rightsHolderId} onValueChange={setRightsHolderId}><SelectTrigger className="w-full lg:w-60"><SelectValue placeholder={t("admin.producers.rightsHolder")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allRightsHolders")}</SelectItem>{rightsHolders.map(holder => <SelectItem key={holder.id} value={holder.id}>{holder.full_name}</SelectItem>)}</SelectContent></Select>
      <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full lg:hidden"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name">{t("admin.producers.producer")}</SelectItem><SelectItem value="works">{t("admin.producers.works")}</SelectItem><SelectItem value="contracts">{t("admin.producers.contracts")}</SelectItem><SelectItem value="latest">{t("admin.producers.latest")}</SelectItem></SelectContent></Select>
      <Button variant="outline" onClick={() => setDirection(value => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? "A–Z" : "Z–A"}</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={toggleAll}>{allSelected ? t("common.deselectAll") : t("common.selectAll")}</Button>{selected.length > 0 && <><span className="text-sm text-muted-foreground">{t("common.selectedCount", { count: selected.length })}</span>{canMerge && selected.length === 2 && <Button variant="outline" size="sm" disabled={merging} onClick={mergeSelected}>{merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("admin.producers.merge")}</Button>}<Button variant="ghost" size="sm" onClick={() => setSelected([])}>{t("common.clearSelection")}</Button></>}</div>

    {loading ? <TableSkeleton columns={7} rows={8} /> : <>
      <MobileCardList>{producers.length ? producers.map(producer => <MobileDataCard key={producer.id}><div className="flex items-start gap-3"><input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} /><Building2 className="h-4 w-4 text-muted-foreground" /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => openEdit(producer)}><p className="font-medium hover:underline">{producer.name}</p><p className="text-sm text-muted-foreground">{producer.parent_name ?? "—"}</p></button><Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2"><MobileMetaRow label={t("admin.producers.works")}>{producer.work_count}</MobileMetaRow><MobileMetaRow label={t("admin.producers.contracts")}>{producer.contract_count}</MobileMetaRow></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => openEdit(producer)}><Pencil className="mr-1 h-3.5 w-3.5" />Rediger</Button><Button size="sm" variant="outline" onClick={() => toggleDetail(producer.id, "legal_entities")}><Building2 className="mr-1 h-3.5 w-3.5" />{t("admin.producers.legalEntities")}</Button><Button size="sm" variant="outline" onClick={() => toggleDetail(producer.id, "works")}><Film className="mr-1 h-3.5 w-3.5" />{t("admin.producers.works")}</Button><Button size="sm" variant="outline" onClick={() => toggleDetail(producer.id, "contracts")}><FileText className="mr-1 h-3.5 w-3.5" />{t("admin.producers.contracts")}</Button></div><DetailPanel producer={producer} type="legal_entities" /><DetailPanel producer={producer} type="works" /><DetailPanel producer={producer} type="contracts" /></MobileDataCard>) : <MobileDataCard><p className="py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</p></MobileDataCard>}</MobileCardList>
      <ResponsiveTableFrame><Table><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("common.selectAll")} /></TableHead>{[["name","admin.producers.producer"],["parent","admin.producers.parent"],["status","common.status"],["works","admin.producers.works"],["contracts","admin.producers.contracts"],["latest","admin.producers.latest"]].map(([key,label]) => <TableHead key={key}><button type="button" onClick={() => changeSort(key)}>{t(label as Parameters<typeof t>[0])}{mark(key)}</button></TableHead>)}</TableRow></TableHeader><TableBody>{producers.length ? producers.map(producer => <Fragment key={producer.id}><TableRow><TableCell><input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} /></TableCell><TableCell className="font-medium"><div className="flex items-center gap-2"><button type="button" className="text-left hover:underline" onClick={() => openEdit(producer)}>{producer.name}</button><Button size="sm" variant="ghost" className="h-auto px-1.5 py-1 text-xs font-normal text-muted-foreground" onClick={() => toggleDetail(producer.id, "legal_entities")} aria-label={`${t("admin.producers.legalEntities")} – ${producer.name}`}><Building2 className="mr-1 h-3.5 w-3.5" />{producer.legal_entities.length}</Button><Button size="icon" variant="ghost" onClick={() => openEdit(producer)} aria-label={`Rediger ${producer.name}`}><Pencil className="h-4 w-4" /></Button></div></TableCell><TableCell>{producer.parent_name ?? "—"}</TableCell><TableCell><Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge></TableCell><TableCell><button type="button" className="flex items-center gap-1" onClick={() => toggleDetail(producer.id, "works")}>{open.has(detailKey(producer.id,"works")) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{producer.work_count}</button></TableCell><TableCell><button type="button" className="flex items-center gap-1" onClick={() => toggleDetail(producer.id, "contracts")}>{open.has(detailKey(producer.id,"contracts")) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{producer.contract_count}</button></TableCell><TableCell>{producer.latest_activity ? new Date(producer.latest_activity).toLocaleDateString(locale === "da" ? "da-DK" : "en-GB") : "—"}</TableCell></TableRow>{open.has(detailKey(producer.id,"legal_entities")) && <TableRow><TableCell colSpan={7} className="p-0"><DetailPanel producer={producer} type="legal_entities" /></TableCell></TableRow>}{open.has(detailKey(producer.id,"works")) && <TableRow><TableCell colSpan={7} className="p-0"><DetailPanel producer={producer} type="works" /></TableCell></TableRow>}{open.has(detailKey(producer.id,"contracts")) && <TableRow><TableCell colSpan={7} className="p-0"><DetailPanel producer={producer} type="contracts" /></TableCell></TableRow>}</Fragment>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("common.noResults")}</TableCell></TableRow>}</TableBody></Table></ResponsiveTableFrame>
    </>}

    <Dialog open={Boolean(editor)} onOpenChange={openState => { if (!openState) setEditor(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editor?.id ? "Rediger producent" : "Tilføj producent"}</DialogTitle>
          <DialogDescription>Producentnavnet er den fælles DFI-identitet. CVR, adresse og telefon gemmes på de juridiske enheder.</DialogDescription>
        </DialogHeader>
        {editor && <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Producentnavn</Label>
            <div className="flex gap-2"><Input value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /><Button type="button" variant="outline" disabled={dfiSearching || editor.name.trim().length < 2} onClick={searchDfiCompanies}>{dfiSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Find hos DFI</Button></div>
            {dfiResults.length > 0 && <div className="rounded-md border p-2">{dfiResults.map(result => <button key={result.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { setEditor({ ...editor, name: result.name, dfiCompanyId: result.id }); setDfiResults([]); }}>{result.name}<span className="ml-2 text-xs text-muted-foreground">DFI #{result.id}</span></button>)}</div>}
            <p className="text-xs text-muted-foreground">DFI-id: {editor.dfiCompanyId || "Ikke valgt"}. DFI leverer ikke CVR-oplysninger.</p>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div><Label>Søg i CVR</Label><p className="text-xs text-muted-foreground">Søg på CVR-nummer eller virksomhedsnavn. Navnesøgning tillader stavevariationer og delvise matches.</p></div>
            <div className="flex gap-2"><Input value={cvrQuery} onChange={event => setCvrQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchCvrCompanies(); } }} placeholder="CVR eller virksomhedsnavn" /><Button type="button" variant="outline" disabled={cvrSearching} onClick={() => void searchCvrCompanies()}>{cvrSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Søg i CVR</Button></div>
            {cvrResults.length > 0 && <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">{cvrResults.map(result => <button key={result.cvrNumber} type="button" className="block w-full rounded px-2 py-2 text-left hover:bg-muted" onClick={() => void selectCvrCompany(result)}><span className="block text-sm font-medium">{result.name}</span><span className="block text-xs text-muted-foreground">CVR {result.cvrNumber}{result.industryDescription ? ` · ${result.industryDescription}` : ""}</span></button>)}</div>}
          </div>
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Juridiske enheder og CVR</h3><p className="text-xs text-muted-foreground">En kanonisk producent kan have flere CVR-numre.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setEditor({ ...editor, legalEntities: [...editor.legalEntities, emptyLegalEntity()] })}><Plus className="mr-1 h-3.5 w-3.5" />Tilføj CVR</Button></div>
            {editor.legalEntities.map((entity, index) => <div key={entity.id ?? `new-${index}`} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label>Juridisk selskabsnavn</Label><Input value={entity.legalName} onChange={event => updateLegalEntity(index, { legalName: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>CVR</Label><div className="flex gap-2"><Input inputMode="numeric" value={entity.registrationNumber} onChange={event => updateLegalEntity(index, { registrationNumber: event.target.value })} /><Button type="button" variant="outline" disabled={cvrLoadingIndex === index} onClick={() => lookupCvr(index)}>{cvrLoadingIndex === index ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hent"}</Button></div></div>
              <div className="space-y-1.5"><Label>Telefonnummer</Label><Input type="tel" value={entity.contactPhone} onChange={event => updateLegalEntity(index, { contactPhone: event.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Adresse</Label><Input value={entity.address} onChange={event => updateLegalEntity(index, { address: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>E-mail</Label><Input type="email" value={entity.contactEmail} onChange={event => updateLegalEntity(index, { contactEmail: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>Website</Label><Input type="url" value={entity.website} onChange={event => updateLegalEntity(index, { website: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>CVR-status</Label><Input value={entity.registrationStatus} onChange={event => updateLegalEntity(index, { registrationStatus: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>Virksomhedsform</Label><Input value={entity.companyType} onChange={event => updateLegalEntity(index, { companyType: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>Branchekode</Label><Input value={entity.industryCode} onChange={event => updateLegalEntity(index, { industryCode: event.target.value })} /></div>
              <div className="space-y-1.5"><Label>Branche</Label><Input value={entity.industryDescription} onChange={event => updateLegalEntity(index, { industryDescription: event.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={entity.isPrimary} onChange={event => setEditor({ ...editor, legalEntities: editor.legalEntities.map((row, rowIndex) => ({ ...row, isPrimary: event.target.checked && rowIndex === index })) })} />Primær juridisk enhed</label>
            </div>)}
          </div>
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setEditor(null)}>Annuller</Button><Button type="button" disabled={savingEditor || !editor?.name.trim()} onClick={saveEditor}>{savingEditor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gem producent</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
