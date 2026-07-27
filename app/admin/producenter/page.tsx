"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Radio, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ExpandableListTrigger, MobileCardList, MobileDataCard, MobileMetaRow, ResponsiveTableFrame } from "@/components/responsive-data-view";
import { TableSkeleton } from "@/components/ui/data-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkedRecordEditorDialog } from "@/components/admin/linked-record-editor-dialog";
import { mergeCvrLegalEntity } from "@/lib/admin-producers";

type LegalEntitySummary = { id: string; legal_name: string; registration_country: string; registration_type: string; registration_number: string | null; entity_kind: string; is_primary: boolean; registration_status: string | null; address?: string | null; contact_phone?: string | null; contact_email?: string | null; website?: string | null; industry_code?: string | null; industry_description?: string | null; company_type?: string | null };
type BroadcasterOption = { id: string; name: string; logo_path: string | null; content_type: string | null };
type AssociationMembership = { id: string; group_code: string; group_label: string; membership_type: "ordinary" | "associate" | "unknown"; source_name: string; owner_ceo_text: string | null; website: string | null; address: string | null; postal_city: string | null; source_url: string; is_active: boolean; verified_on: string; last_seen_at: string };
type Producer = { id: string; name: string; dfi_company_id: number | null; broadcaster_id: string | null; broadcasters: { name: string; logo_path: string | null; content_type: string | null } | Array<{ name: string; logo_path: string | null; content_type: string | null }> | null; parent_name: string | null; status: "attention" | "active" | "inactive"; work_count: number; contract_count: number; latest_activity: string | null; legal_entities: LegalEntitySummary[]; aliases: string[]; association_memberships: AssociationMembership[] };
type RightsHolder = { id: string; full_name: string };
type WorkDetail = { id: string; title: string; type: string; year: number | null; status: string };
type ContractDetail = { id: string; working_title: string | null; type: string; status: string; contract_date: string | null; created_at: string; rettighedshavere: { full_name: string | null } | Array<{ full_name: string | null }> | null };
type DetailState = { loading: boolean; error: string | null; rows: Array<WorkDetail | ContractDetail | LegalEntitySummary> };
type DetailType = "works" | "contracts" | "legal_entities";
type LegalEntityDraft = { id?: string; legalName: string; registrationNumber: string; address: string; contactPhone: string; contactEmail: string; website: string; registrationStatus: string; industryCode: string; industryDescription: string; companyType: string; isPrimary: boolean };
type ProducerDraft = { id?: string; name: string; dfiCompanyId: string; isBroadcaster: boolean; broadcasterId: string; affectedWorkCount: number; legalEntities: LegalEntityDraft[]; deletedLegalEntityIds: string[] };
type CvrSearchResult = { name: string; cvrNumber: string; industryCode: string | null; industryDescription: string | null; score?: number };
type SyncCandidate = { id: string; name: string; score: number; matchMethod: string };
type SyncGroup = { groupCode: string; groupLabel: string; membershipType: "ordinary" | "associate" | "unknown"; sourceName: string; ownerCeoText: string | null; website: string | null; address: string | null; postalCity: string | null; sourceUrl: string };
type SyncPreviewItem = { sourceKey: string; sourceName: string; ownerCeoText: string | null; website: string | null; groups: SyncGroup[]; recommendation: "match" | "create" | "review"; suggestedEmployerId: string | null; suggestedEmployerName: string | null; candidates: SyncCandidate[] };
type SyncPreview = { runId: string; verifiedOn: string; items: SyncPreviewItem[]; summary: { sourceRows: number; uniqueProducers: number; matchedCount: number; reviewCount: number; createCount: number; missingCount: number } };
type SyncDecision = { action: "match" | "create" | "skip"; employerId?: string | null };

const emptyLegalEntity = (): LegalEntityDraft => ({ legalName: "", registrationNumber: "", address: "", contactPhone: "", contactEmail: "", website: "", registrationStatus: "", industryCode: "", industryDescription: "", companyType: "", isPrimary: false });

const statusTone = { attention: "border-amber-300 bg-amber-100 text-amber-800", active: "border-emerald-300 bg-emerald-100 text-emerald-800", inactive: "border-border bg-muted text-muted-foreground" };

export default function ProducersPage() {
  const { t, locale } = useI18n();
  const [producers, setProducers] = useState<Producer[]>([]);
  const [rightsHolders, setRightsHolders] = useState<RightsHolder[]>([]);
  const [broadcasters, setBroadcasters] = useState<BroadcasterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [associationGroup, setAssociationGroup] = useState("all");
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
  const [editingLinkedRecord, setEditingLinkedRecord] = useState<{ id: string; kind: "work" | "contract"; title: string } | null>(null);
  const [editorRelationsOpen, setEditorRelationsOpen] = useState<Set<"works" | "contracts">>(new Set());
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncApplying, setSyncApplying] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncDecisions, setSyncDecisions] = useState<Record<string, SyncDecision>>({});
  const [lastSync, setLastSync] = useState<{ status: string; verified_on: string; applied_at: string | null; created_at: string } | null>(null);

  useEffect(() => {
    void fetch("/api/admin/producers/association-sync").then(async response => {
      if (!response.ok) return;
      const json = await response.json();
      setLastSync(json.lastRun ?? null);
    }).catch(() => undefined);
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ sort, direction });
      if (query.trim()) params.set("query", query.trim());
      if (status !== "all") params.set("status", status);
      if (associationGroup !== "all") params.set("associationGroup", associationGroup);
      if (rightsHolderId !== "all") params.set("rightsHolderId", rightsHolderId);
      try {
        const response = await fetch(`/api/admin/producers?${params}`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setProducers(json.data ?? []); setRightsHolders(json.rightsHolders ?? []); setBroadcasters(json.broadcasters ?? []); setCanMerge(Boolean(json.canMerge));
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProducers([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, status, associationGroup, rightsHolderId, sort, direction, refreshKey]);

  const openCreate = () => {
    setDfiResults([]);
    setCvrQuery("");
    setCvrResults([]);
    setEditorRelationsOpen(new Set());
    setEditor({ name: "", dfiCompanyId: "", isBroadcaster: false, broadcasterId: "", affectedWorkCount: 0, legalEntities: [{ ...emptyLegalEntity(), isPrimary: true }], deletedLegalEntityIds: [] });
  };
  const openEdit = (producer: Producer) => {
    setDfiResults([]);
    setCvrQuery(producer.name);
    setCvrResults([]);
    setEditorRelationsOpen(new Set());
    setEditor({
      id: producer.id,
      name: producer.name,
      dfiCompanyId: producer.dfi_company_id ? String(producer.dfi_company_id) : "",
      isBroadcaster: Boolean(producer.broadcaster_id),
      broadcasterId: producer.broadcaster_id ?? "",
      affectedWorkCount: producer.work_count,
      deletedLegalEntityIds: [],
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
      const legalEntities = mergeCvrLegalEntity(editor.legalEntities, entity);
      setEditor({ ...editor, name: editor.name.trim() || result.name, legalEntities });
      setCvrQuery(result.cvrNumber);
      setCvrResults([]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "CVR-data kunne ikke hentes"); }
    finally { setCvrSearching(false); }
  };
  const removeLegalEntity = (index: number) => {
    if (!editor) return;
    const entity = editor.legalEntities[index];
    if (!entity) return;
    const label = entity.legalName.trim() || entity.registrationNumber || "den juridiske enhed";
    if (!window.confirm(`Slet “${label}” fra producenten? Historiske tilknytninger bevares.`)) return;
    const remaining = editor.legalEntities.filter((_, rowIndex) => rowIndex !== index);
    const legalEntities = entity.isPrimary && remaining.length > 0 && !remaining.some(row => row.isPrimary)
      ? remaining.map((row, rowIndex) => ({ ...row, isPrimary: rowIndex === 0 }))
      : remaining;
    setEditor({
      ...editor,
      legalEntities,
      deletedLegalEntityIds: entity.id
        ? [...new Set([...editor.deletedLegalEntityIds, entity.id])]
        : editor.deletedLegalEntityIds,
    });
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

  const previewAssociationSync = async () => {
    setSyncOpen(true);
    setSyncLoading(true);
    setSyncPreview(null);
    try {
      const response = await fetch("/api/admin/producers/association-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview" }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Medlemslisten kunne ikke hentes");
      const preview = json as SyncPreview;
      setSyncPreview(preview);
      setSyncDecisions(Object.fromEntries(preview.items.map(item => [item.sourceKey, item.recommendation === "match" && item.suggestedEmployerId
        ? { action: "match", employerId: item.suggestedEmployerId }
        : item.recommendation === "create" ? { action: "create" } : { action: "skip" }])));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Medlemslisten kunne ikke hentes"); }
    finally { setSyncLoading(false); }
  };

  const applyAssociationSync = async () => {
    if (!syncPreview) return;
    const decisions = syncPreview.items.map(item => ({ sourceKey: item.sourceKey, ...(syncDecisions[item.sourceKey] ?? { action: "skip" as const }) }));
    if (!decisions.some(decision => decision.action !== "skip")) { toast.error("Vælg mindst én producent, der skal opdateres eller oprettes"); return; }
    setSyncApplying(true);
    try {
      const response = await fetch("/api/admin/producers/association-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", runId: syncPreview.runId, decisions }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Synkroniseringen fejlede");
      toast.success(`${json.matchedCount ?? 0} producenter blev opdateret, og ${json.createdCount ?? 0} blev oprettet`);
      if ((json.skipped ?? []).length) toast.info(`${json.skipped.length} usikre matches blev ikke ændret`);
      setSyncOpen(false);
      setSyncPreview(null);
      setRefreshKey(value => value + 1);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Synkroniseringen fejlede"); }
    finally { setSyncApplying(false); }
  };

  const allSelected = producers.length > 0 && producers.every(producer => selected.includes(producer.id));
  const activeCount = producers.filter(producer => producer.status === "active").length;
  const attentionCount = producers.filter(producer => producer.status === "attention").length;
  const totalWorks = producers.reduce((sum, producer) => sum + producer.work_count, 0);
  const totalContracts = producers.reduce((sum, producer) => sum + producer.contract_count, 0);
  const associationMemberCount = producers.filter(producer => producer.association_memberships.length > 0).length;
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
  const toggleEditorRelation = (producerId: string, type: "works" | "contracts") => {
    const opening = !editorRelationsOpen.has(type);
    setEditorRelationsOpen(current => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next; });
    if (opening) void loadDetails(producerId, type);
  };
  const toggleProducer = (id: string) => {
    const isOpen = open.has(id);
    setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    if (!isOpen) {
      void loadDetails(id, "legal_entities");
      void loadDetails(id, "works");
      void loadDetails(id, "contracts");
    }
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
    return <div className="border-t bg-muted/20 p-4">
      {state?.loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</div>
        : state?.error ? <div className="flex items-center gap-2 text-sm text-destructive">{state.error}<Button size="sm" variant="outline" onClick={() => void loadDetails(producer.id, type, true)}>{t("common.retry")}</Button></div>
        : !state?.rows.length ? <p className="text-sm text-muted-foreground">{type === "works" ? t("admin.producers.noWorks") : type === "contracts" ? t("admin.producers.noContracts") : t("admin.producers.noLegalEntities")}</p>
        : <div className="space-y-2">{state.rows.map(row => type === "works" ? (() => { const work = row as WorkDetail; return <button type="button" onClick={() => setEditingLinkedRecord({ id: work.id, kind: "work", title: work.title })} key={work.id} className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-left text-sm hover:bg-muted/50"><span className="font-medium">{work.title}</span><span className="text-muted-foreground">{work.year ?? "—"} · {work.type}</span></button>; })() : type === "contracts" ? (() => { const contract = row as ContractDetail; const holder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere; return <button type="button" onClick={() => setEditingLinkedRecord({ id: contract.id, kind: "contract", title: contract.working_title ?? "Kontrakt" })} key={contract.id} className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-md border bg-background p-3 text-left text-sm hover:bg-muted/50"><span><span className="block font-medium">{contract.working_title ?? "—"}</span><span className="text-xs text-muted-foreground">{holder?.full_name ?? "—"}</span></span><Badge variant="outline">{contract.status}</Badge></button>; })() : (() => { const entity = row as LegalEntitySummary; return <div key={entity.id} className="grid gap-1 rounded-md border bg-background p-3 text-sm sm:grid-cols-[1fr_auto]"><span><span className="block font-medium">{entity.legal_name}</span><span className="text-xs text-muted-foreground">{entity.entity_kind === "spv" ? "SPV" : entity.entity_kind === "subsidiary" ? t("admin.producers.subsidiary") : t("admin.producers.company")}{entity.registration_status ? ` · ${entity.registration_status}` : ""}</span></span><span className="text-muted-foreground">{entity.registration_number ? `${entity.registration_type} ${entity.registration_number}` : t("admin.producers.noRegistration")}{entity.is_primary ? ` · ${t("admin.producers.primary")}` : ""}</span></div>; })())}</div>}
    </div>;
  };

  const ProducerDetails = ({ producer }: { producer: Producer }) => {
    const broadcaster = Array.isArray(producer.broadcasters) ? producer.broadcasters[0] : producer.broadcasters;
    return <div className="space-y-4 border-t bg-muted/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {producer.dfi_company_id && <Badge variant="outline">DFI #{producer.dfi_company_id}</Badge>}
        {broadcaster && <Badge variant="outline" className="gap-1"><Radio className="h-3.5 w-3.5" />{broadcaster.name} · broadcaster/streamer</Badge>}
      </div>
      <section><h3 className="px-1 pb-2 text-sm font-semibold">Juridiske enheder og CVR</h3><DetailPanel producer={producer} type="legal_entities" /></section>
      <section><h3 className="px-1 pb-2 text-sm font-semibold">Tilknyttede værker</h3><DetailPanel producer={producer} type="works" /></section>
      <section><h3 className="px-1 pb-2 text-sm font-semibold">Tilknyttede kontrakter</h3><DetailPanel producer={producer} type="contracts" /></section>
    </div>;
  };

  const editingProducer = editor?.id ? producers.find(producer => producer.id === editor.id) ?? null : null;

  return <div className="space-y-6">
    <PageHeader title={t("admin.producers.title")} subtitle={t("admin.producers.subtitle")} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void previewAssociationSync()}><RefreshCw className="mr-2 h-4 w-4" />Hent fra Producentforeningen</Button><Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Tilføj producent</Button></div>} />
    {lastSync && <p className="-mt-4 text-xs text-muted-foreground">Producentforeningen: seneste {lastSync.status === "applied" ? "gennemførte" : "forsøgte"} synkronisering {new Date(lastSync.applied_at ?? lastSync.created_at).toLocaleString("da-DK")}</p>}
    {!loading && <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-6">
      {[
        { label: "Viste producenter", value: producers.length },
        { label: "Aktive", value: activeCount },
        { label: "Kræver opmærksomhed", value: attentionCount },
        { label: "Medlem af Producentforeningen", value: associationMemberCount },
        { label: "Tilknyttede værker", value: totalWorks },
        { label: "Tilknyttede kontrakter", value: totalContracts },
      ].map(item => <div key={item.label} className="rounded-lg border bg-card px-5 py-4 text-card-foreground">
        <p className="mb-1 text-sm font-medium text-muted-foreground">{item.label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{item.value}</p>
      </div>)}
    </div>}
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
      <div className="relative flex-1 lg:max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9 pr-9" placeholder={t("admin.producers.search")} />{query && <button type="button" aria-label={t("common.clearSearch")} onClick={() => setQuery("")} className="absolute right-3 top-2.5"><X className="h-4 w-4" /></button>}</div>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allStatuses")}</SelectItem><SelectItem value="attention">{statusLabel("attention")}</SelectItem><SelectItem value="active">{statusLabel("active")}</SelectItem><SelectItem value="inactive">{statusLabel("inactive")}</SelectItem></SelectContent></Select>
      <Select value={associationGroup} onValueChange={setAssociationGroup}><SelectTrigger className="w-full lg:w-60"><SelectValue placeholder="Producentforeningen" /></SelectTrigger><SelectContent><SelectItem value="all">Alle medlemsgrupper</SelectItem><SelectItem value="member">Medlem af Producentforeningen</SelectItem><SelectItem value="documentary">Dokumentarfilm</SelectItem><SelectItem value="fiction">Spillefilm - fiktion</SelectItem><SelectItem value="tv">TV</SelectItem><SelectItem value="advertising">Reklamefilm</SelectItem><SelectItem value="dubbing">Dubbing</SelectItem><SelectItem value="animation">Animation</SelectItem></SelectContent></Select>
      <Select value={rightsHolderId} onValueChange={setRightsHolderId}><SelectTrigger className="w-full lg:w-60"><SelectValue placeholder={t("admin.producers.rightsHolder")} /></SelectTrigger><SelectContent><SelectItem value="all">{t("admin.producers.allRightsHolders")}</SelectItem>{rightsHolders.map(holder => <SelectItem key={holder.id} value={holder.id}>{holder.full_name}</SelectItem>)}</SelectContent></Select>
      <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full lg:hidden"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="name">{t("admin.producers.producer")}</SelectItem><SelectItem value="works">{t("admin.producers.works")}</SelectItem><SelectItem value="contracts">{t("admin.producers.contracts")}</SelectItem><SelectItem value="latest">{t("admin.producers.latest")}</SelectItem></SelectContent></Select>
      <Button variant="outline" onClick={() => setDirection(value => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? "A–Z" : "Z–A"}</Button>
    </div>
    <Button variant="outline" className="w-full md:hidden" onClick={toggleAll}>{allSelected ? t("common.deselectAll") : t("common.selectAll")}</Button>
    {selected.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"><span className="text-sm font-medium">{t("common.selectedCount", { count: selected.length })}</span><div className="flex flex-wrap gap-2">{canMerge && selected.length === 2 && <Button variant="outline" size="sm" disabled={merging} onClick={mergeSelected}>{merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("admin.producers.merge")}</Button>}<Button variant="outline" size="sm" onClick={() => setSelected([])}>{t("common.clearSelection")}</Button></div></div>}

    {loading ? <TableSkeleton columns={7} rows={8} /> : <>
      <MobileCardList>{producers.length ? producers.map(producer => {
        const isExpanded = open.has(producer.id);
        const broadcaster = Array.isArray(producer.broadcasters) ? producer.broadcasters[0] : producer.broadcasters;
        return <MobileDataCard key={producer.id}>
          <div className="flex items-start gap-3">
            <input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} />
            <ExpandableListTrigger expanded={isExpanded} onToggle={() => toggleProducer(producer.id)} label={isExpanded ? `Skjul detaljer for ${producer.name}` : `Vis detaljer for ${producer.name}`} className="mt-0.5" />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openEdit(producer)}><p className="font-medium hover:underline">{producer.name}</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{producer.association_memberships.length > 0 && <Badge variant="outline">Producentforeningen</Badge>}<span className="text-sm text-muted-foreground">{broadcaster ? `${broadcaster.name} · broadcaster/streamer` : producer.parent_name ?? "—"}</span></div></button>
            <Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2"><MobileMetaRow label={t("admin.producers.works")}>{producer.work_count}</MobileMetaRow><MobileMetaRow label={t("admin.producers.contracts")}>{producer.contract_count}</MobileMetaRow></div>
          {isExpanded && <div className="-mx-4 -mb-4 mt-4"><ProducerDetails producer={producer} /></div>}
        </MobileDataCard>;
      }) : <MobileDataCard><p className="py-6 text-center text-sm text-muted-foreground">{t("common.noResults")}</p></MobileDataCard>}</MobileCardList>
      <ResponsiveTableFrame><Table><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("common.selectAll")} /></TableHead>{[["name","admin.producers.producer"],["parent","admin.producers.parent"],["status","common.status"],["works","admin.producers.works"],["contracts","admin.producers.contracts"],["latest","admin.producers.latest"]].map(([key,label]) => <TableHead key={key}><button type="button" onClick={() => changeSort(key)}>{t(label as Parameters<typeof t>[0])}{mark(key)}</button></TableHead>)}</TableRow></TableHeader><TableBody>{producers.length ? producers.map(producer => {
        const isExpanded = open.has(producer.id);
        const broadcaster = Array.isArray(producer.broadcasters) ? producer.broadcasters[0] : producer.broadcasters;
        return <Fragment key={producer.id}><TableRow><TableCell><input type="checkbox" checked={selected.includes(producer.id)} onChange={() => toggleSelected(producer.id)} aria-label={t("admin.producers.selectProducer", { name: producer.name })} /></TableCell><TableCell className="font-medium"><div className="flex items-center gap-2"><ExpandableListTrigger expanded={isExpanded} onToggle={() => toggleProducer(producer.id)} label={isExpanded ? `Skjul detaljer for ${producer.name}` : `Vis detaljer for ${producer.name}`} /><button type="button" className="text-left hover:underline" onClick={() => openEdit(producer)}>{producer.name}</button>{producer.dfi_company_id && <span className="text-xs font-normal text-muted-foreground">DFI #{producer.dfi_company_id}</span>}{producer.association_memberships.length > 0 && <Badge variant="outline">Producentforeningen</Badge>}</div></TableCell><TableCell>{broadcaster ? <Badge variant="outline" className="gap-1"><Radio className="h-3 w-3" />{broadcaster.name}</Badge> : producer.parent_name ?? "—"}</TableCell><TableCell><Badge variant="outline" className={statusTone[producer.status]}>{statusLabel(producer.status)}</Badge></TableCell><TableCell>{producer.work_count}</TableCell><TableCell>{producer.contract_count}</TableCell><TableCell>{producer.latest_activity ? new Date(producer.latest_activity).toLocaleDateString(locale === "da" ? "da-DK" : "en-GB") : "—"}</TableCell></TableRow>{isExpanded && <TableRow><TableCell colSpan={7} className="p-0"><ProducerDetails producer={producer} /></TableCell></TableRow>}</Fragment>;
      }) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("common.noResults")}</TableCell></TableRow>}</TableBody></Table></ResponsiveTableFrame>
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
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><div className="space-y-1.5"><Label>DFI producent-id</Label><Input value={editor.dfiCompanyId} readOnly placeholder="Ikke valgt" /></div>{editor.dfiCompanyId && <Button type="button" variant="ghost" className="self-end" onClick={() => setEditor({ ...editor, dfiCompanyId: "" })}>Fjern DFI-match</Button>}</div>
            <p className="text-xs text-muted-foreground">DFI leverer ikke CVR-oplysninger. CVR-data vedligeholdes separat nedenfor.</p>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Medlem af Producentforeningen</h3><p className="text-xs text-muted-foreground">Oplysningerne kommer fra Producentforeningens offentlige medlemslister.</p></div>{editingProducer?.association_memberships.length ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">Bekræftet medlem</Badge> : <Badge variant="outline">Ikke bekræftet</Badge>}</div>
            {editingProducer?.association_memberships.length ? <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">{editingProducer.association_memberships.map(membership => <Badge key={membership.id} variant="secondary">{membership.group_label}{membership.membership_type === "associate" ? " · associeret" : membership.membership_type === "ordinary" ? " · ordinært" : ""}</Badge>)}</div>
              {editingProducer.association_memberships.find(membership => membership.owner_ceo_text)?.owner_ceo_text && <div><p className="text-xs font-medium text-muted-foreground">Ejere / CEO</p><p className="text-sm">{editingProducer.association_memberships.find(membership => membership.owner_ceo_text)?.owner_ceo_text}</p></div>}
              {editingProducer.association_memberships.find(membership => membership.website)?.website && <div><p className="text-xs font-medium text-muted-foreground">Website</p><a className="text-sm underline underline-offset-2" href={editingProducer.association_memberships.find(membership => membership.website)?.website ?? undefined} target="_blank" rel="noreferrer">{editingProducer.association_memberships.find(membership => membership.website)?.website}</a></div>}
              <p className="text-xs text-muted-foreground">Senest bekræftet {new Date(editingProducer.association_memberships[0].verified_on).toLocaleDateString("da-DK")}. Feltet “Ejere / CEO” er kildens samlede betegnelse og opdeles ikke automatisk.</p>
            </div> : <p className="text-sm text-muted-foreground">Producenten er ikke fundet i den seneste gennemførte medlemssynkronisering.</p>}
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div><Label>Søg i CVR</Label><p className="text-xs text-muted-foreground">Søg på CVR-nummer eller virksomhedsnavn. Navnesøgning tillader stavevariationer og delvise matches.</p></div>
            <div className="flex gap-2"><Input value={cvrQuery} onChange={event => setCvrQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchCvrCompanies(); } }} placeholder="CVR eller virksomhedsnavn" /><Button type="button" variant="outline" disabled={cvrSearching} onClick={() => void searchCvrCompanies()}>{cvrSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Søg i CVR</Button></div>
            {cvrResults.length > 0 && <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">{cvrResults.map(result => <button key={result.cvrNumber} type="button" className="block w-full rounded px-2 py-2 text-left hover:bg-muted" onClick={() => void selectCvrCompany(result)}><span className="block text-sm font-medium">{result.name}</span><span className="block text-xs text-muted-foreground">CVR {result.cvrNumber}{result.industryDescription ? ` · ${result.industryDescription}` : ""}</span></button>)}</div>}
          </div>
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Juridiske enheder og CVR</h3><p className="text-xs text-muted-foreground">En kanonisk producent kan have flere CVR-numre.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setEditor({ ...editor, legalEntities: [...editor.legalEntities, emptyLegalEntity()] })}><Plus className="mr-1 h-3.5 w-3.5" />Tilføj CVR</Button></div>
            {editor.legalEntities.map((entity, index) => <div key={entity.id ?? `new-${index}`} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 sm:col-span-2"><p className="text-sm font-medium">Juridisk enhed {index + 1}</p><Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeLegalEntity(index)}><Trash2 className="mr-1.5 h-4 w-4" />Slet enhed</Button></div>
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
            {editor.legalEntities.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Producenten har ingen juridiske enheder. Brug CVR-søgningen eller “Tilføj CVR” for at tilføje en.</p>}
          </div>
          {editingProducer && <div className="space-y-2 border-t pt-4">
            {(["works", "contracts"] as const).map(type => {
              const expanded = editorRelationsOpen.has(type);
              const count = type === "works" ? editingProducer.work_count : editingProducer.contract_count;
              return <section key={type} className="overflow-hidden rounded-lg border">
                <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => toggleEditorRelation(editingProducer.id, type)} aria-expanded={expanded}>
                  <span><span className="block text-sm font-semibold">{type === "works" ? "Tilknyttede værker" : "Tilknyttede kontrakter"}</span><span className="block text-xs text-muted-foreground">{count} {type === "works" ? (count === 1 ? "værk" : "værker") : (count === 1 ? "kontrakt" : "kontrakter")}</span></span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && <DetailPanel producer={editingProducer} type={type} />}
              </section>;
            })}
          </div>}
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={editor.isBroadcaster} onChange={event => setEditor({ ...editor, isBroadcaster: event.target.checked, broadcasterId: event.target.checked ? editor.broadcasterId : "" })} /><span><span className="block font-medium">Producenten er broadcaster/streamer</span><span className="block text-xs text-muted-foreground">Den valgte broadcaster tilknyttes automatisk alle producentens værker og kan ikke fjernes direkte på værket.</span></span></label>
            {editor.affectedWorkCount > 0 && <p className="text-xs text-muted-foreground">Ændringen synkroniseres til {editor.affectedWorkCount} tilknyttede værk{editor.affectedWorkCount === 1 ? "" : "er"}, når producenten gemmes.</p>}
            {editor.isBroadcaster && <div className="space-y-1.5"><Label>Broadcaster/streamer-identitet</Label><Select value={editor.broadcasterId || undefined} onValueChange={broadcasterId => setEditor({ ...editor, broadcasterId })}><SelectTrigger><SelectValue placeholder="Vælg broadcaster/streamer" /></SelectTrigger><SelectContent>{broadcasters.map(option => <SelectItem key={option.id} value={option.id}>{option.name}{option.content_type ? ` · ${option.content_type}` : ""}</SelectItem>)}</SelectContent></Select>{!editor.broadcasterId && <p className="text-xs text-destructive">Vælg den broadcaster/streamer, producenten er identisk med.</p>}</div>}
            {!broadcasters.length && <p className="text-xs text-muted-foreground">Der er ingen broadcastere i stamdataregisteret endnu.</p>}
          </div>
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setEditor(null)}>Annuller</Button><Button type="button" disabled={savingEditor || !editor?.name.trim() || Boolean(editor?.isBroadcaster && !editor.broadcasterId)} onClick={saveEditor}>{savingEditor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Gem producent</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={syncOpen} onOpenChange={openState => { if (!syncApplying) setSyncOpen(openState); }}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Hent fra Producentforeningen</DialogTitle>
          <DialogDescription>Medlemslisten sammenlignes med eksisterende navne, aliaser og websites. Sikre matches og helt nye producenter er valgt fra start; tvivlsomme matches kræver et aktivt valg.</DialogDescription>
        </DialogHeader>
        {syncLoading ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Henter og kontrollerer seks medlemsgrupper…</div> : syncPreview ? <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{[
            ["Listerækker", syncPreview.summary.sourceRows], ["Producenter", syncPreview.summary.uniqueProducers], ["Sikre matches", syncPreview.summary.matchedCount], ["Nye", syncPreview.summary.createCount], ["Til kontrol", syncPreview.summary.reviewCount], ["Ikke længere set", syncPreview.summary.missingCount],
          ].map(([label, value]) => <div key={String(label)} className="rounded-md border p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>)}</div>
          {syncPreview.summary.missingCount > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Producenter, der ikke blev fundet denne gang, afmeldes ikke automatisk. De skal bekræftes ved en senere synkronisering eller manuelt.</p>}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {syncPreview.items.map(item => {
              const decision = syncDecisions[item.sourceKey] ?? { action: "skip" as const };
              const selectedValue = decision.action === "match" ? `match:${decision.employerId}` : decision.action;
              return <div key={item.sourceKey} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] md:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.sourceName}</p><Badge variant="outline">{item.recommendation === "match" ? "Sikkert match" : item.recommendation === "create" ? "Ny producent" : "Kontrollér match"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.groups.map(group => group.groupLabel).join(" · ")}{item.ownerCeoText ? ` · Ejere / CEO: ${item.ownerCeoText}` : ""}</p></div>
                <Select value={selectedValue} onValueChange={value => setSyncDecisions(current => ({ ...current, [item.sourceKey]: value === "skip" ? { action: "skip" } : value === "create" ? { action: "create" } : { action: "match", employerId: value.replace("match:", "") } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skip">Spring over</SelectItem><SelectItem value="create">Opret ny producent</SelectItem>{item.candidates.map(candidate => <SelectItem key={candidate.id} value={`match:${candidate.id}`}>Knyt til {candidate.name} · {candidate.score}</SelectItem>)}</SelectContent>
                </Select>
              </div>;
            })}
          </div>
        </> : <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Medlemslisten kunne ikke forhåndsvises.</div>}
        <DialogFooter><Button type="button" variant="outline" disabled={syncApplying} onClick={() => setSyncOpen(false)}>Annuller</Button><Button type="button" variant="outline" disabled={syncLoading || syncApplying} onClick={() => void previewAssociationSync()}><RefreshCw className="mr-2 h-4 w-4" />Hent igen</Button><Button type="button" disabled={!syncPreview || syncApplying} onClick={() => void applyAssociationSync()}>{syncApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Synkronisér valgte</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <LinkedRecordEditorDialog record={editingLinkedRecord} onOpenChange={next => { if (!next) setEditingLinkedRecord(null); }} />
  </div>;
}
