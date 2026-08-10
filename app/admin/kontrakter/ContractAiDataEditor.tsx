"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Lock, Sparkles, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getContractValidationSection,
  getContractValidationSummary,
  saveContractValidationSection,
  type ContractValidationSectionKey,
} from "@/app/actions/member-contracts";
import { findContractWorkExternalIds } from "@/app/actions/work-identity";
import { SourceBtn } from "@/components/source-btn";
import { SeasonStepper } from "@/components/works/season-stepper";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import type { SeriesEpisodeOption } from "@/lib/series-episodes";

type FieldType = "text" | "number" | "bool" | "triState" | "signatureMethod" | "textarea";
type Field = { key: string; label: string; type: FieldType; readOnly?: boolean };
type FormValues = Record<string, string | boolean>;
type SummaryData = {
  rights: { copydan: string; streaming: string; signature: string };
  dates: string;
  salary: string;
  series: string;
  signature: string;
  ids: string;
  work: string;
};

const SALARY_SOURCE_LABELS: Record<string, string> = {
  weekly: "Ugeløn fundet direkte",
  daily_converted: "Dagsats omregnet til ugeløn",
  hourly_converted: "Timesats omregnet til ugeløn",
  lump_calculated: "Samlet honorar fordelt over periode",
  invoice_line: "Fakturalinje",
  unknown: "Ukendt kilde",
};
const SALARY_SOURCE_VALUES = Object.fromEntries(Object.entries(SALARY_SOURCE_LABELS).map(([value, label]) => [label, value]));
const ARRAY_KEYS = new Set(["distribution", "productionCountries", "creditedRoles"]);
const NUMBER_KEYS = new Set(["salary", "workingDays", "workingWeeks", "loentillaeg", "pensionPercent", "pensionSupplement", "pensionEmployerPercent", "pensionEmployeePercent", "pensionTotalPercent", "pensionBasisAmount", "personalSupplement", "postProductionSupplement", "royaltyPercent", "holidayPayRate", "betaRate", "signaturePage", "duration", "premiereYear"]);
const SOURCE_KEYS: Record<string, string> = {
  salary: "salary", pensionPercent: "pension", personalSupplement: "supplements", postProductionSupplement: "supplements",
  otherSupplements: "otherSupplements", signatureStatus: "signature", signatureMethod: "signature", signatureDate: "signature",
  signatureEvidence: "signature", signaturePage: "signature", workingWeeks: "workingWeeks",
  agreementReferenceStatus: "collectiveAgreement", copydan: "copydan", svod: "svod",
  workTitle: "workTitle",
};

const FIELDS: Partial<Record<ContractValidationSectionKey, Field[]>> = {
  rights: [
    { key: "copydan", label: "Copydan", type: "triState" },
    { key: "svod", label: "Streaming-forbehold", type: "triState" },
    { key: "agreementReferenceStatus", label: "Direkte overenskomsthenvisning", type: "triState" },
    { key: "rightsNotApplicable", label: "Copydan/streaming er ikke relevant", type: "bool" },
    { key: "hasCreditClause", label: "Krediteringsklausul", type: "bool" },
    { key: "royalty", label: "Royalty", type: "bool" },
    { key: "royaltyPercent", label: "Royalty %", type: "number" },
    { key: "aiDataMiningClause", label: "AI/data mining-forbehold", type: "bool" },
    { key: "futureRightsReservation", label: "Forbehold for fremtidige rettigheder", type: "bool" },
    { key: "distribution", label: "Distribution", type: "text" },
  ],
  salary: [
    { key: "salary", label: "Ugeløn", type: "number" },
    { key: "personalSupplement", label: "Personligt tillæg", type: "number" },
    { key: "postProductionSupplement", label: "Tillæg for efterarbejde", type: "number" },
    { key: "salaryUnit", label: "Lønenhed", type: "text" },
    { key: "salarySourceType", label: "Lønkilde", type: "text" },
    { key: "salaryConfidence", label: "Løn-confidence", type: "text" },
    { key: "salaryNote", label: "Løn-note", type: "textarea" },
    { key: "needsManualSalaryReview", label: "Kræver manuel løngennemgang", type: "bool" },
    { key: "workingDays", label: "Arbejdsdage", type: "number" },
    { key: "workingWeeks", label: "Arbejdsuger", type: "number" },
    { key: "loentillaeg", label: "Løntillæg (fallback)", type: "number" },
    { key: "contractType", label: "Kontrakttype", type: "text", readOnly: true },
    { key: "agreementEmploymentForm", label: "Ansættelsesform i overenskomsten", type: "text", readOnly: true },
    { key: "pensionPercent", label: "Arbejdsgivers pension %", type: "number" },
    { key: "pensionEmployeePercent", label: "Medarbejderens pension %", type: "number" },
    { key: "pensionTotalPercent", label: "Pension i alt %", type: "number", readOnly: true },
    { key: "pensionSupplement", label: "Pensionstillæg", type: "number" },
    { key: "pensionBasis", label: "Pensionsgrundlag", type: "text", readOnly: true },
    { key: "pensionAgreementTitle", label: "Overenskomstkilde", type: "text", readOnly: true },
    { key: "pensionAgreementSection", label: "Afsnit i overenskomsten", type: "text", readOnly: true },
    { key: "pensionEvidence", label: "Begrundelse", type: "textarea", readOnly: true },
    { key: "otherSupplements", label: "Øvrige tillæg", type: "textarea" },
    { key: "holidayPayRate", label: "Feriepenge %", type: "number" },
    { key: "betaRate", label: "BETA-sats", type: "number" },
  ],
  signature: [
    { key: "signatureStatus", label: "Underskrift", type: "triState" },
    { key: "signatureMethod", label: "Underskriftstype", type: "signatureMethod" },
    { key: "signatureDate", label: "Underskriftsdato", type: "text" },
    { key: "signatureEvidence", label: "Evidens for underskrift", type: "textarea" },
    { key: "signaturePage", label: "Side for underskrift", type: "number" },
  ],
  work: [
    { key: "workTitle", label: "Aflæst værkstitel", type: "text", readOnly: true },
    { key: "productionType", label: "Produktionstype", type: "text" },
    { key: "director", label: "Instruktør", type: "text" },
    { key: "duration", label: "Varighed (min.)", type: "number" },
    { key: "premiereYear", label: "Premiereår", type: "number" },
    { key: "genre", label: "Genre", type: "text" },
    { key: "productionCountries", label: "Produktionslande", type: "text" },
    { key: "creditedFunction", label: "Krediteret funktion", type: "text" },
    { key: "creditedRoles", label: "Krediterede roller", type: "text" },
    { key: "description", label: "Beskrivelse", type: "textarea" },
  ],
};

const SECTION_ORDER: Array<{ key: ContractValidationSectionKey; title: string }> = [
  { key: "rights", title: "Rettigheder" },
  { key: "dates", title: "Dato" },
  { key: "salary", title: "Løn og periode" },
  { key: "series", title: "Serie data" },
  { key: "signature", title: "Underskrift" },
  { key: "ids", title: "ID" },
  { key: "work", title: "Værksdata" },
];

function triState(value: unknown) {
  if (value === true) return "yes";
  if (value === false) return "no";
  const normalized = String(value ?? "").toLowerCase();
  if (["yes", "ja", "true", "underskrevet"].includes(normalized)) return "yes";
  if (["no", "nej", "false", "ikke underskrevet"].includes(normalized)) return "no";
  if (normalized.includes("implicit")) return "implicit";
  return "unknown";
}

function toFormValues(data: Record<string, unknown>): FormValues {
  const values: FormValues = {};
  for (const [key, raw] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    if (key === "salarySourceType") values[key] = raw == null ? "" : SALARY_SOURCE_LABELS[String(raw)] ?? String(raw);
    else if (ARRAY_KEYS.has(key)) values[key] = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
    else if (typeof raw === "boolean") values[key] = raw;
    else {
      const text = raw == null ? "" : String(raw);
      values[key] = key.toLowerCase().includes("date") ? text.slice(0, 10) : text;
    }
  }
  return values;
}

function toPatch(values: FormValues, fields: Field[]) {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === "bool") data[field.key] = Boolean(value);
    else if (field.type === "triState" || field.type === "signatureMethod") data[field.key] = String(value || "unknown");
    else if (NUMBER_KEYS.has(field.key)) data[field.key] = value === "" ? null : Number(value);
    else if (ARRAY_KEYS.has(field.key)) data[field.key] = String(value ?? "").split(",").map(item => item.trim()).filter(Boolean);
    else if (field.key === "salarySourceType") data[field.key] = value ? SALARY_SOURCE_VALUES[String(value)] ?? String(value) : null;
    else data[field.key] = value === "" ? null : value;
  }
  if ("copydan" in data || "svod" in data || "agreementReferenceStatus" in data) {
    data.rightsOverview = {
      copydanforbehold: data.copydan === "implicit" ? "implicit via overenskomst" : data.copydan === "yes" ? "ja" : data.copydan === "no" ? "nej" : "uklart",
      streamingforbehold: data.svod === "implicit" ? "implicit via overenskomst" : data.svod === "yes" ? "ja" : data.svod === "no" ? "nej" : "uklart",
      overenskomst: data.agreementReferenceStatus === "yes" ? "ja" : data.agreementReferenceStatus === "no" ? "nej" : "uklart",
    };
  }
  return data;
}

function statusLabel(value: string) {
  if (value === "yes") return "Ja";
  if (value === "no") return "Nej";
  if (value === "implicit") return "Implicit";
  return "Ukendt";
}

export type ContractAiDataEditorProps = {
  contractId: string;
  activeHighlight?: string | null;
  onHighlightClick: (quote: string) => void;
  rereadLoading?: boolean;
  onReread?: () => Promise<void>;
  dates?: { contractDate: string; startDate: string; endDate: string };
  onDatesChange?: (dates: { contractDate: string; startDate: string; endDate: string }) => void;
  isSeries?: boolean;
  season?: number;
  onSeasonChange?: (season: number) => void;
  episodeOptions?: SeriesEpisodeOption[];
  selectedEpisodes?: number[];
  onSelectedEpisodesChange?: (episodes: number[]) => void;
  episodesLoading?: boolean;
  episodesError?: string | null;
  onSeriesOpen?: () => void;
  onValidationChange?: (patch: Record<string, unknown>) => void;
  workingTitle?: string;
  onWorkingTitleChange?: (value: string) => void;
};

export function ContractAiDataEditor(props: ContractAiDataEditorProps) {
  const dates = props.dates ?? { contractDate: "", startDate: "", endDate: "" };
  const season = props.season ?? 1;
  const [summaries, setSummaries] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [open, setOpen] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [values, setValues] = useState<Partial<Record<ContractValidationSectionKey, FormValues>>>({});
  const [rawData, setRawData] = useState<Partial<Record<ContractValidationSectionKey, Record<string, unknown>>>>({});
  const [loading, setLoading] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<ContractValidationSectionKey, string>>>({});
  const [locks, setLocks] = useState<Partial<Record<ContractValidationSectionKey, Set<string>>>>({});
  const [saving, setSaving] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [findingIds, setFindingIds] = useState(false);
  const timers = useRef<Partial<Record<ContractValidationSectionKey, number>>>({});

  const loadSummary = async () => {
    setSummaryLoading(true);
    const result = await getContractValidationSummary(props.contractId);
    if (result.success && "summaries" in result) setSummaries(result.summaries as SummaryData);
    else toast.error(("error" in result ? result.error : null) ?? "Aflæste data kunne ikke hentes");
    setSummaryLoading(false);
  };

  // State is intentionally synchronized when the external dialog, storage, or server source changes.
  useEffect(() => { void loadSummary(); }, [props.contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(timers.current).forEach(timer => timer && window.clearTimeout(timer)), []);

  const loadSection = async (section: ContractValidationSectionKey) => {
    if (values[section] || loading.has(section)) return;
    setLoading(current => new Set(current).add(section));
    setErrors(current => ({ ...current, [section]: undefined }));
    const result = await getContractValidationSection({ contractId: props.contractId, section });
    if (result.success && "data" in result) {
      const data = result.data as Record<string, unknown>;
      setRawData(current => ({ ...current, [section]: data }));
      setValues(current => ({ ...current, [section]: toFormValues(data) }));
      const allLocks = Array.isArray(data._lockedFields) ? data._lockedFields.filter((key): key is string => typeof key === "string") : [];
      setLocks(current => ({ ...current, [section]: new Set(allLocks) }));
    } else setErrors(current => ({ ...current, [section]: ("error" in result ? result.error : null) ?? "Sektionen kunne ikke hentes" }));
    setLoading(current => { const next = new Set(current); next.delete(section); return next; });
  };

  const toggleSection = (section: ContractValidationSectionKey) => {
    const willOpen = !open.has(section);
    setOpen(current => {
      const next = new Set(current);
      if (willOpen) next.add(section);
      else next.delete(section);
      return next;
    });
    if (willOpen) {
      if (section === "series") props.onSeriesOpen?.();
      void loadSection(section);
    }
  };

  const scheduleSave = (section: ContractValidationSectionKey, nextValues: FormValues, nextLocks: Set<string>) => {
    const fields = FIELDS[section];
    if (!fields) return;
    if (timers.current[section]) window.clearTimeout(timers.current[section]);
    timers.current[section] = window.setTimeout(async () => {
      setSaving(current => new Set(current).add(section));
      const result = await saveContractValidationSection({
        contractId: props.contractId,
        section,
        data: toPatch(nextValues, fields),
        lockedFields: [...nextLocks],
      });
      setSaving(current => { const next = new Set(current); next.delete(section); return next; });
      if (!result.success) toast.error(result.error ?? "Data kunne ikke gemmes");
      else void loadSummary();
    }, 700);
  };

  const setField = (section: ContractValidationSectionKey, key: string, value: string | boolean) => {
    const nextValues = { ...(values[section] ?? {}), [key]: value };
    const nextLocks = new Set(locks[section] ?? []); nextLocks.add(key);
    setValues(current => ({ ...current, [section]: nextValues }));
    setLocks(current => ({ ...current, [section]: nextLocks }));
    const fields = FIELDS[section];
    if (fields) props.onValidationChange?.(toPatch(nextValues, fields));
    scheduleSave(section, nextValues, nextLocks);
  };

  const toggleLock = (section: ContractValidationSectionKey, key: string) => {
    const nextLocks = new Set(locks[section] ?? []);
    if (nextLocks.has(key)) nextLocks.delete(key);
    else nextLocks.add(key);
    setLocks(current => ({ ...current, [section]: nextLocks }));
    scheduleSave(section, values[section] ?? {}, nextLocks);
  };

  const summaryText = (section: ContractValidationSectionKey) => {
    if (!summaries) return "";
    if (section === "rights") return `Copydan: ${statusLabel(summaries.rights.copydan)} · streaming: ${statusLabel(summaries.rights.streaming)} · underskrift: ${statusLabel(summaries.rights.signature)}`;
    if (section === "dates") return dates.contractDate || "Ingen kontraktdato";
    if (section === "series") {
      const selected = props.selectedEpisodes ?? [];
      const episodes = selected.length > 0 ? selected.join(", ") : "—";
      return `Sæson ${season} · afsnit ${episodes}`;
    }
    return String(summaries[section]);
  };

  const renderFields = (section: ContractValidationSectionKey) => {
    const sectionValues = values[section] ?? {};
    const sectionRaw = rawData[section] ?? {};
    const sources = (sectionRaw._sources ?? {}) as Record<string, string | null>;
    const pensionTag = section === "salary" ? String(sectionRaw.pensionTag ?? "") : "";
    const pensionUrl = section === "salary" ? String(sectionRaw.pensionAgreementSourceUrl ?? "") : "";
    const pensionStatus = section === "salary" ? String(sectionRaw.pensionStatus ?? "") : "";
    return <div className="grid gap-3 sm:grid-cols-2">
      {pensionTag && <div className={`rounded-md border px-3 py-2 text-sm sm:col-span-2 ${pensionStatus === "inferred_agreement" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : pensionStatus === "review_required" ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-muted/40"}`}>
        <div className="font-medium">{pensionTag}</div>
        {pensionUrl && <a className="mt-1 inline-block text-xs underline underline-offset-2" href={pensionUrl} target="_blank" rel="noreferrer">Se den officielle kilde</a>}
      </div>}
      {(FIELDS[section] ?? []).map(field => {
      const quote = sources[SOURCE_KEYS[field.key]];
      const locked = locks[section]?.has(field.key) ?? false;
      return <div key={field.key} className={field.type === "textarea" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">{field.label}</Label>
          {!field.readOnly && <div className="flex items-center gap-1">
            {quote && <SourceBtn quote={quote} active={props.activeHighlight === quote} onClick={() => props.onHighlightClick(quote)} />}
            <button type="button" title={locked ? "Feltet er låst for AI-overskrivning" : "Lås felt for AI-overskrivning"} aria-label={locked ? "Lås feltet op for AI-overskrivning" : "Beskyt feltet mod AI-overskrivning"} onClick={() => toggleLock(section, field.key)} className="p-1 text-muted-foreground hover:text-foreground">
              {locked ? <Lock className="h-3.5 w-3.5 text-amber-600" /> : <Unlock className="h-3.5 w-3.5 opacity-30" />}
            </button>
          </div>}
        </div>
        {field.type === "textarea" ? <Textarea disabled={field.readOnly} value={String(sectionValues[field.key] ?? "")} onChange={event => setField(section, field.key, event.target.value)} />
          : field.type === "triState" ? <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={triState(sectionValues[field.key])} onChange={event => setField(section, field.key, event.target.value)}><option value="unknown">Ukendt</option><option value="yes">Ja</option><option value="no">Nej</option>{field.key !== "agreementReferenceStatus" && <option value="implicit">Implicit via overenskomst</option>}</select>
          : field.type === "signatureMethod" ? <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={String(sectionValues[field.key] || "unknown")} onChange={event => setField(section, field.key, event.target.value)}><option value="unknown">Ukendt</option><option value="handwritten">Håndskrevet</option><option value="digital">Digital</option><option value="none">Ingen</option></select>
          : field.type === "bool" ? <button type="button" onClick={() => setField(section, field.key, !sectionValues[field.key])} className={`h-9 w-full rounded-md border px-3 text-left text-sm ${sectionValues[field.key] ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "bg-background text-muted-foreground"}`}>{sectionValues[field.key] ? "Ja" : "Nej"}</button>
          : <Input disabled={field.readOnly} inputMode={field.type === "number" ? "decimal" : undefined} value={String(sectionValues[field.key] ?? "")} onChange={event => setField(section, field.key, event.target.value)} />}
      </div>;
    })}</div>;
  };

  const renderSection = (section: ContractValidationSectionKey) => {
    if (section === "dates") return <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1"><Label>Kontraktdato</Label><Input type="date" value={dates.contractDate} onChange={event => props.onDatesChange?.({ ...dates, contractDate: event.target.value })} /></div>
      <div className="space-y-1"><Label>Startdato</Label><Input type="date" value={dates.startDate} onChange={event => props.onDatesChange?.({ ...dates, startDate: event.target.value })} /></div>
      <div className="space-y-1"><Label>Slutdato</Label><Input type="date" value={dates.endDate} onChange={event => props.onDatesChange?.({ ...dates, endDate: event.target.value })} /></div>
    </div>;
    if (section === "series") return <div className="space-y-3">
      <SeasonStepper value={season} onChange={value => props.onSeasonChange?.(value)} compact />
      {props.episodesLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter afsnit…</div>
        : props.episodesError ? <p className="text-sm text-destructive">{props.episodesError}</p>
        : <SeriesEpisodeSelector season={season} onSeasonChange={value => props.onSeasonChange?.(value)} options={props.episodeOptions ?? []} selected={props.selectedEpisodes ?? []} onSelectedChange={values => props.onSelectedEpisodesChange?.(values)} showSeason={false} compact />}
      {renderFields(section)}
    </div>;
    if (section === "ids") {
      const sectionValues = values.ids ?? {};
      const hasExternalId = ["dfiId", "tmdbId", "imdbId"].some(key => String(sectionValues[key] ?? "").trim());
      return <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3">{[["dfiId", "DFI-id"], ["tmdbId", "TMDB-id"], ["imdbId", "IMDb-id"]].map(([key, label]) => <div key={key} className="space-y-1"><Label>{label}</Label><Input readOnly value={String(sectionValues[key] ?? "")} className="bg-muted/30" /></div>)}</div>{!hasExternalId && <Button type="button" variant="outline" disabled={findingIds} onClick={async () => { setFindingIds(true); try { const result = await findContractWorkExternalIds(props.contractId); if (!result.success || !result.ids) toast.error(result.error ?? "ID-opslaget gav intet sikkert match"); else { setValues(current => ({ ...current, ids: { ...(current.ids ?? {}), ...result.ids } })); toast.success("Eksterne ID’er blev fundet og gemt"); } } finally { setFindingIds(false); } }}>{findingIds && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Find ID’er i eksterne databaser</Button>}</div>;
    }
    if (section === "work") return <div className="space-y-4">
      <div className="space-y-1"><Label>Arbejdstitel</Label><Input value={props.workingTitle ?? ""} placeholder="Produktionens arbejdstitel…" onChange={event => props.onWorkingTitleChange?.(event.target.value)} /></div>
      {renderFields(section)}
    </div>;
    return renderFields(section);
  };

  const sections = useMemo(() => SECTION_ORDER.filter(section => section.key !== "series" || props.isSeries), [props.isSeries]);
  return <div className="rounded-lg border bg-card">
    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="font-semibold">Aflæst fra kontrakt</h3><p className="text-xs text-muted-foreground">Fold en sektion ud for at se eller redigere de aflæste oplysninger.</p></div>
      {props.onReread && <Button type="button" variant="outline" size="sm" className="w-full gap-2 sm:w-auto" onClick={async () => { await props.onReread?.(); setValues({}); setRawData({}); setOpen(new Set()); await loadSummary(); }} disabled={props.rereadLoading}>
        {props.rereadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Genindlæs kontrakt
      </Button>}
    </div>
    <div className="divide-y">
      {sections.map(section => {
        const expanded = open.has(section.key);
        return <div key={section.key}>
          <button type="button" onClick={() => toggleSection(section.key)} aria-expanded={expanded} className="flex h-12 w-full min-w-0 items-center gap-3 px-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="shrink-0 text-sm font-medium">{section.title}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summaryLoading ? "Henter…" : summaryText(section.key)}</span>
            {saving.has(section.key) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          {expanded && <div className="border-t bg-muted/10 p-4">
            {loading.has(section.key) ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter sektion…</div>
              : errors[section.key] ? <div className="space-y-2"><p className="text-sm text-destructive">{errors[section.key]}</p><Button type="button" variant="outline" size="sm" onClick={() => void loadSection(section.key)}>Prøv igen</Button></div>
              : renderSection(section.key)}
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
