"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ExternalLink, Film, FileText, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { archiveAdminWorks, createAdminWork, deleteAdminWorkPermanently, fetchAdminRightsHolders, fetchAdminWorkDetail, updateAdminWorkData } from "@/app/actions/work-management";
import { addAdminContractComment, deleteAdminContractsPermanently, fetchAdminContractEditorData, getContractSignedUrl, markContractCommentsRead, updateAdminContract, validateAdminContracts } from "@/app/actions/member-contracts";
import { clearAdminMessageThread, deleteAdminMessage } from "@/app/actions/admin-messages";
import { ProductionCompanyPicker } from "@/components/production-company-picker";
import { ManualWorkFormFields } from "@/components/works/manual-work-form";
import { RightsHolderAutocomplete } from "@/components/admin/rights-holder-autocomplete";
import { ContractAiDataEditor } from "@/app/admin/kontrakter/ContractAiDataEditor";
import { MessageThread, type MessageThreadMessage } from "@/components/messages/message-thread";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WORK_TYPES } from "@/lib/work-types";
import type { ProductionCompanySelection } from "@/lib/production-companies";
import { emptyManualWorkForm, validateManualWork, type ManualWorkFormValue } from "@/lib/manual-work";

type EditorFooterProps = { saving: boolean; dirty: boolean; onCancel: () => void; onSave: () => void };

function EditorFooter({ saving, dirty, onCancel, onSave }: EditorFooterProps) {
  return <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
    <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Annuller</Button>
    <Button type="button" onClick={onSave} disabled={saving || !dirty}>
      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Gem ændringer
    </Button>
  </div>;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground">
    <h3 className="text-sm font-semibold">{title}</h3>
    {children}
  </section>;
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

type WorkEditorForm = {
  title: string;
  type: string;
  year: string;
  duration: string;
  seasonCount: string;
  episodeCount: string;
  seasonNumber: string;
  episodeNumber: string;
  genre: string;
  director: string;
  productionCompanies: string;
  description: string;
  dfiId: string;
  tmdbId: string;
  imdbId: string;
  posterUrl: string;
  status: string;
};

type WorkRecord = Record<string, unknown> & {
  id: string;
  title?: string | null;
  type?: string | null;
  year?: number | null;
  duration_minutes?: number | null;
  season_count?: number | null;
  episode_count?: number | null;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  genre?: string | null;
  director?: string | null;
  alternative_titles?: string[] | null;
  production_countries?: string[] | null;
  production_companies?: string[] | null;
  description?: string | null;
  dfi_id?: string | null;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  field_sources?: Record<string, string> | null;
  poster_url?: string | null;
  status?: string | null;
  work_assignments?: Array<{ id: string; role: string; share_percent?: number | null; rettighedshavere?: { id: string; full_name: string } | null }>;
  contracts?: Array<{ id: string; type: string | null; status: string | null; created_at: string; rettighedshavere?: { full_name?: string | null } | null }>;
  work_change_requests?: Array<{ id: string; status: string; source: string; created_at: string; rettighedshavere?: { full_name?: string | null } | null }>;
};

type WorkAssignmentDraft = { id?: string; rightsHolderId: string; name: string; role: string; sharePercent: string };

function workForm(record: WorkRecord): WorkEditorForm {
  return {
    title: record.title ?? "",
    type: record.type ?? "spillefilm",
    year: record.year?.toString() ?? "",
    duration: record.duration_minutes?.toString() ?? "",
    seasonCount: record.season_count?.toString() ?? "",
    episodeCount: record.episode_count?.toString() ?? "",
    seasonNumber: record.season_number?.toString() ?? "",
    episodeNumber: record.episode_number?.toString() ?? "",
    genre: record.genre ?? "",
    director: record.director ?? "",
    productionCompanies: (record.production_companies ?? []).join(", "),
    description: record.description ?? "",
    dfiId: record.dfi_id ?? "",
    tmdbId: record.tmdb_id?.toString() ?? "",
    imdbId: record.imdb_id ?? "",
    posterUrl: record.poster_url ?? "",
    status: record.status ?? "godkendt",
  };
}

export function SharedWorkEditor({ workId, onClose, onSaved }: { workId: string; onClose: () => void; onSaved?: () => void }) {
  const [record, setRecord] = useState<WorkRecord | null>(null);
  const [form, setForm] = useState<WorkEditorForm | null>(null);
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState<WorkAssignmentDraft[]>([]);
  const [rightsHolders, setRightsHolders] = useState<Array<{ id: string; full_name: string }>>([]);
  const [newRightsHolderId, setNewRightsHolderId] = useState("");
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchAdminWorkDetail(workId), fetchAdminRightsHolders()]).then(([result, rightsResult]) => {
      if (cancelled) return;
      if (!result.success || !result.work) {
        toast.error(result.error ?? "Værket kunne ikke hentes");
        onCloseRef.current();
        return;
      }
      const nextRecord = result.work as WorkRecord;
      const nextForm = workForm(nextRecord);
      setRecord(nextRecord);
      setForm(nextForm);
      const nextAssignments = (nextRecord.work_assignments ?? []).map(assignment => ({
        id: assignment.id,
        rightsHolderId: assignment.rettighedshavere?.id ?? "",
        name: assignment.rettighedshavere?.full_name ?? "Ukendt rettighedshaver",
        role: assignment.role || "Klipper",
        sharePercent: assignment.share_percent?.toString() ?? "",
      }));
      setAssignments(nextAssignments);
      setRightsHolders(rightsResult.rightsHolders ?? []);
      setInitial(JSON.stringify({ form: nextForm, assignments: nextAssignments }));
    }).catch(error => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : "Værket kunne ikke hentes");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workId]);

  const dirty = Boolean(form && JSON.stringify({ form, assignments }) !== initial);
  const update = <K extends keyof WorkEditorForm>(key: K, value: WorkEditorForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const cancel = () => {
    if (dirty && !window.confirm("Du har ændringer, der ikke er gemt. Vil du lukke alligevel?")) return;
    onClose();
  };

  const save = async () => {
    if (!form || !record) return;
    if (!form.title.trim()) return toast.error("Titel skal udfyldes");
    setSaving(true);
    try {
      await updateAdminWorkData({
        workId,
        data: {
          title: form.title.trim(),
          type: form.type,
          year: nullableNumber(form.year),
          duration_minutes: nullableNumber(form.duration),
          season_count: nullableNumber(form.seasonCount),
          episode_count: nullableNumber(form.episodeCount),
          parent_work_id: record.parent_work_id ?? null,
          season_number: nullableNumber(form.seasonNumber),
          episode_number: nullableNumber(form.episodeNumber),
          genre: form.genre.trim() || null,
          director: form.director.trim() || null,
          alternative_titles: record.alternative_titles ?? [],
          production_countries: record.production_countries ?? [],
          production_companies: form.productionCompanies.split(",").map(value => value.trim()).filter(Boolean),
          description: form.description.trim() || null,
          dfi_id: form.dfiId.trim() || null,
          tmdb_id: nullableNumber(form.tmdbId),
          imdb_id: form.imdbId.trim() || null,
          field_sources: { ...(record.field_sources ?? {}), title: "manual" },
          poster_url: form.posterUrl.trim() || null,
          status: form.status,
        },
        assignments: assignments.map(assignment => ({
          id: assignment.id,
          rightsHolderId: assignment.rightsHolderId,
          role: assignment.role,
          sharePercent: nullableNumber(assignment.sharePercent),
        })),
        replaceAssignments: true,
      });
      toast.success("Værket er gemt");
      window.dispatchEvent(new Event("works-updated"));
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Værket kunne ikke gemmes");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Henter værksdata…</div>;
  const series = form.type === "tv-serie" || form.type === "dokumentar-serie";
  const archive = async () => {
    if (!window.confirm(`Arkivér “${form.title}”? Kontrakter, rettighedshavere og historik bevares.`)) return;
    setSaving(true);
    try {
      await archiveAdminWorks({ workIds: [workId] });
      toast.success("Værket er arkiveret");
      window.dispatchEvent(new Event("works-updated"));
      onSaved?.();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Værket kunne ikke arkiveres"); }
    finally { setSaving(false); }
  };
  const deleteWork = async () => {
    if (!window.confirm(`Slet “${form.title}” permanent? Tilknytninger fjernes, og kontrakter sættes tilbage til Mangler værk.`)) return;
    setSaving(true);
    try {
      await deleteAdminWorkPermanently({ workId });
      toast.success("Værket er slettet permanent");
      window.dispatchEvent(new Event("works-updated"));
      onSaved?.();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Værket kunne ikke slettes"); }
    finally { setSaving(false); }
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
        <Badge variant="outline">{form.status}</Badge>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void archive()}><Archive className="mr-1.5 h-4 w-4" />Arkivér værk</Button>
          <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void deleteWork()}><Trash2 className="mr-1.5 h-4 w-4" />Slet permanent</Button>
        </div>
      </div>
      <FormSection title="Grundoplysninger">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Titel</Label><Input value={form.title} onChange={event => update("title", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Værktype</Label><Select value={form.type} onValueChange={value => update("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WORK_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Premiereår</Label><Input inputMode="numeric" value={form.year} onChange={event => update("year", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Varighed i minutter</Label><Input inputMode="numeric" value={form.duration} onChange={event => update("duration", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Genre</Label><Input value={form.genre} onChange={event => update("genre", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Instruktør</Label><Input value={form.director} onChange={event => update("director", event.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Produktionsselskaber</Label><Input value={form.productionCompanies} onChange={event => update("productionCompanies", event.target.value)} placeholder="Adskil flere selskaber med komma" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Beskrivelse</Label><Textarea rows={4} value={form.description} onChange={event => update("description", event.target.value)} /></div>
        </div>
      </FormSection>
      {series && <FormSection title="Serie og afsnit">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5"><Label>Antal sæsoner</Label><Input inputMode="numeric" value={form.seasonCount} onChange={event => update("seasonCount", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Antal afsnit</Label><Input inputMode="numeric" value={form.episodeCount} onChange={event => update("episodeCount", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Sæson</Label><Input inputMode="numeric" value={form.seasonNumber} onChange={event => update("seasonNumber", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Afsnit</Label><Input inputMode="numeric" value={form.episodeNumber} onChange={event => update("episodeNumber", event.target.value)} /></div>
        </div>
      </FormSection>}
      <FormSection title="Rettighedshavere og medklippere">
        <div className="space-y-3">
          {assignments.map((assignment, index) => <div key={assignment.id ?? `${assignment.rightsHolderId}-${index}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_180px_120px_auto] sm:items-end">
            <div><Label>Rettighedshaver</Label><p className="mt-2 text-sm font-medium">{assignment.name}</p></div>
            <div><Label>Rolle</Label><Input value={assignment.role} onChange={event => setAssignments(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item))} /></div>
            <div><Label>Andel i %</Label><Input inputMode="decimal" value={assignment.sharePercent} onChange={event => setAssignments(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, sharePercent: event.target.value } : item))} /></div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Fjern ${assignment.name}`} onClick={() => setAssignments(current => current.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /></Button>
          </div>)}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div><Label>Tilføj rettighedshaver</Label><RightsHolderAutocomplete value={newRightsHolderId} onChange={setNewRightsHolderId} options={rightsHolders.filter(holder => !assignments.some(assignment => assignment.rightsHolderId === holder.id))} /></div>
            <Button type="button" variant="outline" disabled={!newRightsHolderId} onClick={() => {
              const holder = rightsHolders.find(item => item.id === newRightsHolderId);
              if (!holder) return;
              setAssignments(current => [...current, { rightsHolderId: holder.id, name: holder.full_name, role: "Klipper", sharePercent: "" }]);
              setNewRightsHolderId("");
            }}><Plus className="mr-1.5 h-4 w-4" />Tilføj</Button>
          </div>
        </div>
      </FormSection>
      <FormSection title="Tilknyttede kontrakter">
        <div className="space-y-2">{(record?.contracts ?? []).length ? record?.contracts?.map(contract => <div key={contract.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"><div><p className="font-medium">{contract.rettighedshavere?.full_name ?? "Ukendt medlem"}</p><p className="text-xs text-muted-foreground">{contract.type ?? "Kontrakt"}</p></div><Badge variant="outline">{contract.status ?? "ukendt"}</Badge></div>) : <p className="text-sm text-muted-foreground">Ingen kontrakter er tilknyttet værket.</p>}</div>
      </FormSection>
      {(record?.work_change_requests ?? []).length > 0 && <FormSection title="Kommentarer og requests">
        <div className="space-y-2">{record?.work_change_requests?.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"><div><p className="font-medium">{request.rettighedshavere?.full_name ?? "Ukendt medlem"}</p><p className="text-xs text-muted-foreground">{request.source} · {new Date(request.created_at).toLocaleDateString("da-DK")}</p></div><Badge variant="outline">{request.status}</Badge></div>)}</div>
      </FormSection>}
      <FormSection title="Datakilder og status">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>DFI-id</Label><Input value={form.dfiId} onChange={event => update("dfiId", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>TMDB-id</Label><Input value={form.tmdbId} onChange={event => update("tmdbId", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>IMDb-id</Label><Input value={form.imdbId} onChange={event => update("imdbId", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={value => update("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="aktiv">Aktiv</SelectItem><SelectItem value="godkendt">Godkendt</SelectItem><SelectItem value="til_godkendelse">Til godkendelse</SelectItem><SelectItem value="afsluttet">Afsluttet</SelectItem><SelectItem value="arkiveret">Arkiveret</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Poster-URL</Label><Input value={form.posterUrl} onChange={event => update("posterUrl", event.target.value)} /></div>
        </div>
      </FormSection>
    </div>
    <EditorFooter saving={saving} dirty={dirty} onCancel={cancel} onSave={() => void save()} />
  </div>;
}

type WorkOption = { id: string; title: string; year: number | null; type: string | null };

function WorkAutocomplete({ options, value, onChange }: { options: WorkOption[]; value: string; onChange: (value: string) => void }) {
  const selected = options.find(option => option.id === value);
  const [query, setQuery] = useState(selected?.title ?? "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("da");
    return options.filter(option => !needle || option.title.toLocaleLowerCase("da").includes(needle)).slice(0, 12);
  }, [options, query]);
  return <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
    <Input value={query} className="pl-9" placeholder="Søg værk…" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={event => { setQuery(event.target.value); setOpen(true); if (value) onChange(""); }} />
    {open && <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">{matches.length ? matches.map(option => <button type="button" key={option.id} className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-accent" onMouseDown={event => event.preventDefault()} onClick={() => { onChange(option.id); setQuery(option.title); setOpen(false); }}><span className="block font-medium">{option.title}</span><span className="text-xs text-muted-foreground">{option.year ?? "–"} · {option.type ?? "Ukendt type"}</span></button>) : <p className="p-2 text-sm text-muted-foreground">Ingen værker fundet</p>}</div>}
  </div>;
}

type ContractEditorForm = {
  type: string; overenskomst: string; status: string; contractDate: string; startDate: string; endDate: string;
  rightsHolderId: string; workId: string; workingTitle: string; seasonNumber: string; episodeNumbers: string;
};

type ContractComment = { id: string; author_role: "admin" | "member"; message: string; created_at: string; member_read_at?: string | null; admin_read_at?: string | null };

type ContractEditorPayload = {
  contract: {
    id: string; type: string | null; overenskomst: string | null; status: string | null; pdf_url: string | null; contract_date: string | null; start_date: string | null; end_date: string | null;
    rights_holder_id: string | null; work_id: string | null; working_title: string | null; season_number: number | null; episode_numbers: number[] | null;
    contract_comments?: ContractComment[];
    contract_attachments?: Array<{ id: string; title?: string | null; ai_status?: string | null }>;
  };
  rightsHolders: Array<{ id: string; full_name: string }>;
  works: WorkOption[];
  producerSelections: ProductionCompanySelection[];
};

export function SharedContractEditor({ contractId, onClose, onSaved }: { contractId: string; onClose: () => void; onSaved?: () => void }) {
  const [payload, setPayload] = useState<ContractEditorPayload | null>(null);
  const [form, setForm] = useState<ContractEditorForm | null>(null);
  const [producers, setProducers] = useState<ProductionCompanySelection[]>([]);
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualWork, setManualWork] = useState<ManualWorkFormValue>(() => emptyManualWorkForm());
  const [reply, setReply] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAdminContractEditorData(contractId).then(result => {
      if (cancelled) return;
      if (!result.success || !result.contract) {
        toast.error(result.error ?? "Kontrakten kunne ikke hentes");
        onCloseRef.current();
        return;
      }
      const data = result as unknown as ContractEditorPayload & { success: true };
      const contract = data.contract;
      const nextForm: ContractEditorForm = {
        type: contract.type ?? "a-løn", overenskomst: contract.overenskomst ?? "ingen", status: contract.status ?? "kladde",
        contractDate: contract.contract_date ?? "", startDate: contract.start_date ?? "", endDate: contract.end_date ?? "",
        rightsHolderId: contract.rights_holder_id ?? "", workId: contract.work_id ?? "", workingTitle: contract.working_title ?? "",
        seasonNumber: contract.season_number?.toString() ?? "", episodeNumbers: (contract.episode_numbers ?? []).join(", "),
      };
      setPayload(data);
      setForm(nextForm);
      setProducers(data.producerSelections ?? []);
      setManualWork(emptyManualWorkForm({ title: contract.working_title ?? "", contract_id: contract.id }));
      setInitial(JSON.stringify({ form: nextForm, producers: data.producerSelections ?? [] }));
      void markContractCommentsRead(contractId, "admin");
    }).catch(error => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke hentes"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contractId]);

  const dirty = Boolean(form && (manualMode || JSON.stringify({ form, producers }) !== initial));
  const update = <K extends keyof ContractEditorForm>(key: K, value: ContractEditorForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const cancel = () => {
    if (dirty && !window.confirm("Du har ændringer, der ikke er gemt. Vil du lukke alligevel?")) return;
    onClose();
  };
  const save = async () => {
    if (!form) return;
    if (manualMode) {
      const validationError = validateManualWork(manualWork, "da");
      if (validationError) return toast.error(validationError);
    }
    setSaving(true);
    try {
      let workId = form.workId || null;
      if (manualMode) {
        const created = await createAdminWork({
          data: {
            title: manualWork.title.trim(),
            type: manualWork.type,
            year: nullableNumber(manualWork.year),
            duration_minutes: nullableNumber(manualWork.duration_minutes),
            season_count: null,
            episode_count: nullableNumber(manualWork.episode_count),
            parent_work_id: null,
            season_number: nullableNumber(manualWork.season_number),
            episode_number: nullableNumber(manualWork.episode_number),
            genre: null,
            director: manualWork.director.trim() || null,
            alternative_titles: [],
            production_countries: [],
            production_companies: manualWork.production_companies.map(company => company.canonicalName),
            description: null,
            dfi_id: null,
            tmdb_id: null,
            poster_url: null,
          },
          seasonNumber: nullableNumber(manualWork.season_number),
          selectedEpisodes: manualWork.selected_episodes,
          productionCompanies: manualWork.production_companies,
          status: "godkendt",
        });
        workId = created.workId;
        if (!workId) throw new Error("Værket kunne ikke oprettes");
      }
      const episodeNumbers = [...new Set(form.episodeNumbers.split(/[,;\s]+/).map(Number).filter(number => Number.isInteger(number) && number > 0))];
      const result = await updateAdminContract(contractId, {
        type: form.type, overenskomst: form.overenskomst === "ingen" ? null : form.overenskomst, status: form.status,
        contract_date: form.contractDate || null, start_date: form.startDate || null, end_date: form.endDate || null,
        employer_id: producers[0]?.employerId ?? null, rights_holder_id: form.rightsHolderId || null, work_id: workId,
        working_title: form.workingTitle.trim() || null, season_number: nullableNumber(form.seasonNumber), episode_numbers: episodeNumbers.length ? episodeNumbers : null,
        producer_selections: producers,
      });
      if (!result.success) throw new Error(result.error ?? "Kontrakten kunne ikke gemmes");
      toast.success("Kontrakten er gemt");
      window.dispatchEvent(new Event("contracts-updated"));
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke gemmes");
    } finally { setSaving(false); }
  };

  const archiveContract = async () => {
    if (!form || !window.confirm("Arkivér kontrakten? Dokument, beskeder og relationer bevares.")) return;
    update("status", "arkiveret");
    setSaving(true);
    try {
      const result = await updateAdminContract(contractId, { status: "arkiveret" });
      if (!result.success) throw new Error(result.error ?? "Kontrakten kunne ikke arkiveres");
      toast.success("Kontrakten er arkiveret");
      window.dispatchEvent(new Event("contracts-updated"));
      onSaved?.();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke arkiveres"); }
    finally { setSaving(false); }
  };
  const deleteContract = async () => {
    if (!window.confirm("Slet kontrakten permanent? Dokument, AI-data, allonger og beskeder slettes også.")) return;
    setSaving(true);
    try {
      const result = await deleteAdminContractsPermanently([contractId]);
      if (!result.success) throw new Error(result.error ?? "Kontrakten kunne ikke slettes");
      toast.success("Kontrakten er slettet permanent");
      window.dispatchEvent(new Event("contracts-updated"));
      onSaved?.();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke slettes"); }
    finally { setSaving(false); }
  };
  const validateContract = async () => {
    if (!form?.workId) return toast.error("Forbind kontrakten med et værk før validering");
    setSaving(true);
    try {
      const saved = await updateAdminContract(contractId, { status: "valideret", work_id: form.workId, rights_holder_id: form.rightsHolderId || null });
      if (!saved.success) throw new Error(saved.error ?? "Kontrakten kunne ikke gemmes");
      const result = await validateAdminContracts([contractId]);
      if (!result.success) throw new Error(result.error ?? "Kontrakten kunne ikke valideres");
      toast.success("Kontrakten er valideret");
      window.dispatchEvent(new Event("contracts-updated"));
      onSaved?.();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kontrakten kunne ikke valideres"); }
    finally { setSaving(false); }
  };
  const openDocument = async () => {
    const path = payload?.contract.pdf_url;
    if (!path) return toast.error("Kontrakten har ikke et dokument");
    const result = await getContractSignedUrl(path);
    if (!result.url) return toast.error(result.error ?? "Dokumentet kunne ikke åbnes");
    window.open(result.url, "_blank", "noopener,noreferrer");
  };
  const messages: MessageThreadMessage[] = (payload?.contract.contract_comments ?? []).map(comment => ({
    id: comment.id,
    authorRole: comment.author_role,
    message: comment.message,
    createdAt: comment.created_at,
    memberReadAt: comment.member_read_at,
    adminReadAt: comment.admin_read_at,
  }));
  const sendReply = async () => {
    if (!reply.trim()) return;
    setReplySaving(true);
    try {
      const result = await addAdminContractComment(contractId, reply);
      if (!result.success || !result.comment) throw new Error(result.error ?? "Beskeden kunne ikke sendes");
      const comment = result.comment as ContractComment;
      setPayload(current => current ? { ...current, contract: { ...current.contract, contract_comments: [...(current.contract.contract_comments ?? []), comment] } } : current);
      setReply("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Beskeden kunne ikke sendes"); }
    finally { setReplySaving(false); }
  };

  if (loading || !form || !payload) return <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Henter kontraktdata…</div>;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
        <Badge variant="outline">{form.status}</Badge>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void openDocument()} disabled={!payload.contract.pdf_url}><ExternalLink className="mr-1.5 h-4 w-4" />Se kontrakt</Button>
          <Button type="button" size="sm" onClick={() => void validateContract()} disabled={saving || form.status === "valideret"}>Validér kontrakt</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void archiveContract()} disabled={saving}><Archive className="mr-1.5 h-4 w-4" />Arkivér</Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => void deleteContract()} disabled={saving}><Trash2 className="mr-1.5 h-4 w-4" />Slet permanent</Button>
        </div>
      </div>
      <FormSection title="Produktion og parter">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-1.5"><Label>Rettighedshaver</Label><RightsHolderAutocomplete options={payload.rightsHolders} value={form.rightsHolderId} onChange={value => update("rightsHolderId", value)} /></div>
          <div className="min-w-0 space-y-1.5"><ProductionCompanyPicker value={producers} onChange={setProducers} label="Producent" /></div>
        </div>
      </FormSection>
      <FormSection title="Forbind med værk">
        <div className="grid gap-4 sm:grid-cols-2">
          {!manualMode && <div className="space-y-1.5 sm:col-span-2"><Label>Værk</Label><WorkAutocomplete options={payload.works} value={form.workId} onChange={value => update("workId", value)} /></div>}
          <div className="sm:col-span-2">
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setManualMode(current => !current);
              if (!manualMode) {
                update("workId", "");
                setManualWork(current => ({ ...current, title: current.title || form.workingTitle }));
              }
            }}>
              {manualMode ? "Tilbage til søgning" : <><Plus className="mr-1.5 h-4 w-4" />Indtast manuelt</>}
            </Button>
          </div>
          {manualMode && <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
            <ManualWorkFormFields value={manualWork} onChange={setManualWork} locale="da" />
          </div>}
          <div className="space-y-1.5 sm:col-span-2"><Label>Arbejdstitel</Label><Input value={form.workingTitle} onChange={event => update("workingTitle", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Sæson</Label><Input inputMode="numeric" value={form.seasonNumber} onChange={event => update("seasonNumber", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Afsnit</Label><Input value={form.episodeNumbers} onChange={event => update("episodeNumbers", event.target.value)} placeholder="Fx 1, 2, 5" /></div>
        </div>
      </FormSection>
      <FormSection title="Kontraktoplysninger">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5"><Label>Kontrakttype</Label><Select value={form.type} onValueChange={value => update("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a-løn">A-løn</SelectItem><SelectItem value="leverandør">Leverandør</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Overenskomst</Label><Select value={form.overenskomst} onValueChange={value => update("overenskomst", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de4-fiktion">De4 (fiktion)</SelectItem><SelectItem value="faf">FAF (fiktion)</SelectItem><SelectItem value="faf-dokumentar">FAF (dokumentar)</SelectItem><SelectItem value="dj">DJ</SelectItem><SelectItem value="metal">Metal</SelectItem><SelectItem value="ingen">Ingen</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Status</Label><Select value={form.status} onValueChange={value => update("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="kladde">Kladde</SelectItem><SelectItem value="valideret">Valideret</SelectItem><SelectItem value="arkiveret">Arkiveret</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Kontraktdato</Label><Input type="date" value={form.contractDate} onChange={event => update("contractDate", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Startdato</Label><Input type="date" value={form.startDate} onChange={event => update("startDate", event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Slutdato</Label><Input type="date" value={form.endDate} onChange={event => update("endDate", event.target.value)} /></div>
        </div>
      </FormSection>
      <FormSection title="Data fra kontrakt og tilknyttet værk">
        <ContractAiDataEditor contractId={contractId} onHighlightClick={() => undefined} />
      </FormSection>
      {(payload.contract.contract_attachments ?? []).length > 0 && <FormSection title="Allonger">
        <div className="space-y-2">{payload.contract.contract_attachments?.map(attachment => <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"><span className="font-medium">{attachment.title ?? "Allonge"}</span><Badge variant="outline">{attachment.ai_status ?? "afventer"}</Badge></div>)}</div>
      </FormSection>}
      <MessageThread
        title="Beskeder"
        messages={messages}
        viewerRole="admin"
        emptyText=""
        composerValue={reply}
        onComposerChange={setReply}
        onSend={() => void sendReply()}
        composerLoading={replySaving}
        composerPlaceholder="Skriv besked"
        sendLabel="Send besked"
        onDeleteMessage={async messageId => {
          await deleteAdminMessage({ kind: "contract", threadId: contractId, messageId });
          setPayload(current => current ? { ...current, contract: { ...current.contract, contract_comments: (current.contract.contract_comments ?? []).filter(comment => comment.id !== messageId) } } : current);
        }}
        onClearThread={async () => {
          await clearAdminMessageThread({ kind: "contract", threadId: contractId });
          setPayload(current => current ? { ...current, contract: { ...current.contract, contract_comments: [] } } : current);
        }}
      />
    </div>
    <EditorFooter saving={saving} dirty={dirty} onCancel={cancel} onSave={() => void save()} />
  </div>;
}

export function EditorKindIcon({ kind }: { kind: "work" | "contract" }) {
  return kind === "work" ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />;
}
