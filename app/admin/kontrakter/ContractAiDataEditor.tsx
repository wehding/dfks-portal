"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { CalendarDays, Check, ChevronDown, Loader2, Lock, Pencil, ShieldCheck, Signature, Sparkles, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { ContractSourceBadge } from "@/components/contracts/contract-source-badge";
import type { ContractFieldSource } from "@/lib/contract-workbench";
import type { ContractEvidenceBbox, ContractEvidenceCoordinateSource } from "@/lib/contract-workbench";
import type { SeriesEpisodeOption } from "@/lib/series-episodes";

type FieldType = "text" | "number" | "bool" | "triState" | "signatureMethod" | "textarea" | "date";
type Field = { key: string; label: string; type: FieldType; readOnly?: boolean };
type FormValues = Record<string, string | boolean>;
export type ContractEvidenceActivation = {
  fieldKey: string;
  label?: string;
  sourceKey: string;
  quote: string;
  focusText?: string | null;
  clauseId?: string | null;
  page?: number | null;
  bbox?: ContractEvidenceBbox | null;
  coordinateSource?: ContractEvidenceCoordinateSource | null;
  confidence?: number | null;
};
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
const NUMBER_KEYS = new Set(["salary", "workingDays", "workingWeeks", "pensionPercent", "pensionSupplement", "pensionEmployerPercent", "pensionEmployeePercent", "pensionTotalPercent", "pensionBasisAmount", "personalSupplement", "royaltyPercent", "holidayPayRate", "betaRate", "signaturePage", "duration", "premiereYear"]);
const SOURCE_KEYS: Record<string, string> = {
  salary: "salary", pensionPercent: "pension", personalSupplement: "supplements",
  otherSupplements: "otherSupplements", signatureStatus: "signatureEvidence", signatureMethod: "signatureEvidence", signatureDate: "signatureEvidence",
  signatureEvidence: "signatureEvidence", signaturePage: "signatureEvidence", workingWeeks: "workingWeeks",
  agreementReferenceStatus: "collectiveAgreement", copydan: "copydan", svod: "svod",
  hasCreditClause: "creditedRoles", royalty: "royalty", royaltyPercent: "royalty",
  contractDate: "contractDate",
  workTitle: "workTitle",
};

const FIELDS: Partial<Record<ContractValidationSectionKey, Field[]>> = {
  approval: [
    { key: "copydan", label: "Copydan", type: "triState" },
    { key: "hasCreditClause", label: "Krediteringsklausul", type: "bool" },
    { key: "royalty", label: "Royalty", type: "bool" },
    { key: "royaltyPercent", label: "Royalty %", type: "number" },
    { key: "svod", label: "Streaming-forbehold", type: "triState" },
    { key: "signatureStatus", label: "Underskrevet", type: "triState" },
    { key: "contractDate", label: "Kontraktdato", type: "date" },
    { key: "signatureDate", label: "Underskriftsdato", type: "text" },
  ],
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
    { key: "salaryUnit", label: "Lønenhed", type: "text" },
    { key: "salarySourceType", label: "Lønkilde", type: "text" },
    { key: "salaryConfidence", label: "Løn-confidence", type: "text" },
    { key: "salaryNote", label: "Løn-note", type: "textarea" },
    { key: "needsManualSalaryReview", label: "Kræver manuel løngennemgang", type: "bool" },
    { key: "workingDays", label: "Arbejdsdage", type: "number" },
    { key: "workingWeeks", label: "Arbejdsuger", type: "number" },
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
    { key: "otherSupplements", label: "Øvrige tillæg", type: "textarea", readOnly: true },
    { key: "holidayPayRate", label: "Feriepenge %", type: "number" },
    { key: "betaRate", label: "BETA-sats", type: "number" },
  ],
  signature: [
    { key: "signatureMethod", label: "Underskriftstype", type: "signatureMethod" },
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

const EVIDENCE_FOCUS_TERMS: Record<string, string[]> = {
  copydan: ["Copydan"],
  hasCreditClause: ["krediter"],
  royalty: ["royalty"],
  svod: ["streaming", "SVOD"],
};

function evidenceFocusText(field: Field, quote: string | null, value: unknown) {
  if (field.key === "signatureStatus" || field.key === "signatureDate") {
    return null; // Underskrift skal vise underskriftsfeltet, ikke markere ordet "underskrift" i brødtekst
  }
  if (field.type === "text" || field.type === "number" || field.type === "date") {
    return value == null ? null : String(value);
  }
  const normalizedQuote = quote?.toLocaleLowerCase("da") ?? "";
  return EVIDENCE_FOCUS_TERMS[field.key]?.find(term => normalizedQuote.includes(term.toLocaleLowerCase("da"))) ?? null;
}

function CompactYesNo({ value, onChange, label }: { value: unknown; onChange: (value: "yes" | "no") => void; label: string }) {
  const state = triState(value);
  const yes = state === "yes" || state === "implicit";
  return <div className="inline-flex h-8 items-center rounded-md border bg-background p-0.5" role="group" aria-label={label}>
    <button
      type="button"
      className={`flex h-7 w-8 items-center justify-center rounded-sm transition-colors ${yes ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
      aria-label={`${label}: Ja`}
      aria-pressed={yes}
      title={state === "implicit" ? "Ja, via overenskomst" : "Ja"}
      onClick={() => onChange("yes")}
    ><Check className="h-4 w-4" /></button>
    <button
      type="button"
      className={`flex h-7 w-8 items-center justify-center rounded-sm transition-colors ${state === "no" ? "bg-rose-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
      aria-label={`${label}: Nej`}
      aria-pressed={state === "no"}
      title="Nej"
      onClick={() => onChange("no")}
    ><X className="h-4 w-4" /></button>
  </div>;
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
  registerFlush?: (handler: (() => Promise<boolean>) | null) => void;
  section?: ContractValidationSectionKey;
  includeFieldKeys?: string[];
  excludeFieldKeys?: string[];
  requiredFieldKeys?: string[];
  bare?: boolean;
  onEvidenceActivate?: (evidence: ContractEvidenceActivation) => void;
  activeEvidenceFieldKey?: string | null;
  initialData?: Record<string, unknown>;
  onSeriesDataLoaded?: (options: SeriesEpisodeOption[], selectedEpisodes: number[]) => void;
};

export function ContractAiDataEditor(props: ContractAiDataEditorProps) {
  const dates = props.dates ?? { contractDate: "", startDate: "", endDate: "" };
  const season = props.season ?? 1;
  const [summaries, setSummaries] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [open, setOpen] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [values, setValues] = useState<Partial<Record<ContractValidationSectionKey, FormValues>>>(() => props.section && props.initialData
    ? { [props.section]: toFormValues(props.initialData) }
    : {});
  const [rawData, setRawData] = useState<Partial<Record<ContractValidationSectionKey, Record<string, unknown>>>>(() => props.section && props.initialData
    ? { [props.section]: props.initialData }
    : {});
  const [loading, setLoading] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<ContractValidationSectionKey, string>>>({});
  const [locks, setLocks] = useState<Partial<Record<ContractValidationSectionKey, Set<string>>>>({});
  const [saving, setSaving] = useState<Set<ContractValidationSectionKey>>(new Set());
  const [findingIds, setFindingIds] = useState(false);
  const timers = useRef<Partial<Record<ContractValidationSectionKey, number>>>({});
  const pendingSaves = useRef<Partial<Record<ContractValidationSectionKey, { values: FormValues; locks: Set<string> }>>>({});
  const inFlightSaves = useRef<Partial<Record<ContractValidationSectionKey, Promise<boolean>>>>({});
  const loadingSections = useRef(new Set<ContractValidationSectionKey>());

  const activateEvidence = (event: MouseEvent, evidence: ContractEvidenceActivation | null) => {
    if (!evidence || (event.target as Element).closest("button,input,select,textarea,a,[role='combobox']")) return;
    props.onEvidenceActivate?.(evidence);
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    const result = await getContractValidationSummary(props.contractId);
    if (result.success && "summaries" in result) setSummaries(result.summaries as SummaryData);
    else toast.error(("error" in result ? result.error : null) ?? "Aflæste data kunne ikke hentes");
    setSummaryLoading(false);
  };

  // State is intentionally synchronized when the external dialog, storage, or server source changes.
  useEffect(() => {
    if (!props.bare) void loadSummary();
  }, [props.bare, props.contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => Object.values(timers.current).forEach(timer => timer && window.clearTimeout(timer)), []);
  useEffect(() => {
    if (!props.section) return;
    if (props.section === "series") props.onSeriesOpen?.();
    if (!props.initialData) void loadSection(props.section);
    // The section loader is stable around refs and intentionally runs when the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.contractId, props.section, season]);

  const loadSection = async (section: ContractValidationSectionKey, refreshRelations = false) => {
    if ((!refreshRelations && values[section]) || loadingSections.current.has(section)) return;
    loadingSections.current.add(section);
    setLoading(current => new Set(current).add(section));
    setErrors(current => ({ ...current, [section]: undefined }));
    try {
      const result = await getContractValidationSection({ contractId: props.contractId, section });
      if (result.success && "data" in result) {
        const data = result.data as Record<string, unknown>;
        setRawData(current => ({ ...current, [section]: data }));
        setValues(current => ({ ...current, [section]: toFormValues(data) }));
        const allLocks = Array.isArray(data._lockedFields) ? data._lockedFields.filter((key): key is string => typeof key === "string") : [];
        setLocks(current => ({ ...current, [section]: new Set(allLocks) }));
        if (section === "series" && "episodeOptions" in result) {
          const options = (result.episodeOptions ?? [])
            .filter(option => option.seasonNumber === season)
            .map(option => ({ number: option.episodeNumber, title: option.title }));
          const selectedEpisodes = (result.linkedEpisodes ?? [])
            .filter(episode => episode.seasonNumber === season)
            .map(episode => episode.episodeNumber);
          props.onSeriesDataLoaded?.(options, selectedEpisodes);
        }
      } else setErrors(current => ({ ...current, [section]: ("error" in result ? result.error : null) ?? "Sektionen kunne ikke hentes" }));
    } catch (error) {
      setErrors(current => ({ ...current, [section]: error instanceof Error ? error.message : "Sektionen kunne ikke hentes" }));
    } finally {
      loadingSections.current.delete(section);
      setLoading(current => { const next = new Set(current); next.delete(section); return next; });
    }
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

  const persistSection = async (section: ContractValidationSectionKey): Promise<boolean> => {
    const fields = FIELDS[section];
    if (!fields) return true;
    if (timers.current[section]) {
      window.clearTimeout(timers.current[section]);
      delete timers.current[section];
    }

    const currentSave = inFlightSaves.current[section];
    if (currentSave && !(await currentSave)) return false;
    const pending = pendingSaves.current[section];
    if (!pending) return true;
    delete pendingSaves.current[section];

    const operation = (async () => {
      setSaving(current => new Set(current).add(section));
      const result = await saveContractValidationSection({
        contractId: props.contractId,
        section,
        data: toPatch(pending.values, fields),
        lockedFields: [...pending.locks],
      });
      setSaving(current => { const next = new Set(current); next.delete(section); return next; });
      if (!result.success) {
        // Bevar det seneste udkast, så brugeren kan rette eller prøve igen uden
        // at miste ændringerne ved en midlertidig serverfejl.
        if (!pendingSaves.current[section]) pendingSaves.current[section] = pending;
        toast.error(result.error ?? "Data kunne ikke gemmes");
        return false;
      }
      void loadSummary();
      return true;
    })();
    inFlightSaves.current[section] = operation;
    const success = await operation;
    if (inFlightSaves.current[section] === operation) delete inFlightSaves.current[section];
    return success;
  };

  const flushPendingSaves = async () => {
    Object.values(timers.current).forEach(timer => timer && window.clearTimeout(timer));
    timers.current = {};
    const sections = new Set<ContractValidationSectionKey>([
      ...Object.keys(pendingSaves.current) as ContractValidationSectionKey[],
      ...Object.keys(inFlightSaves.current) as ContractValidationSectionKey[],
    ]);
    let success = true;
    for (const section of sections) {
      const currentSave = inFlightSaves.current[section];
      if (currentSave && !(await currentSave)) success = false;
      if (pendingSaves.current[section] && !(await persistSection(section))) success = false;
    }
    return success;
  };

  useEffect(() => {
    props.registerFlush?.(flushPendingSaves);
    return () => props.registerFlush?.(null);
    // Handleren skal altid afspejle den aktuelle kontrakt og de aktuelle refs.
  }, [props.contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = (section: ContractValidationSectionKey, nextValues: FormValues, nextLocks: Set<string>) => {
    const fields = FIELDS[section];
    if (!fields) return;
    pendingSaves.current[section] = { values: nextValues, locks: new Set(nextLocks) };
    if (timers.current[section]) window.clearTimeout(timers.current[section]);
    timers.current[section] = window.setTimeout(() => {
      void persistSection(section);
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
    if (section === "approval") return "";
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
    if (section === "approval") {
      const makeEvidence = (fieldKey: string, label: string): ContractEvidenceActivation => {
        const sourceKey = SOURCE_KEYS[fieldKey] ?? fieldKey;
        const quote = sources[sourceKey] ?? "";
        const pageValue = sources[`${sourceKey}_page`];
        return {
          fieldKey,
          label,
          sourceKey,
          quote,
          focusText: evidenceFocusText({ key: fieldKey, label, type: fieldKey === "royaltyPercent" ? "number" : "triState" }, quote, sectionValues[fieldKey]),
          clauseId: sources[`${sourceKey}_clause_id`] ?? null,
          page: pageValue && Number.isFinite(Number(pageValue)) ? Number(pageValue) : null,
        };
      };
      const sourceFor = (fieldKey: string): ContractFieldSource => {
        const sourceKey = SOURCE_KEYS[fieldKey] ?? fieldKey;
        if (locks.approval?.has(fieldKey)) return "manual";
        if (["royalty", "royaltyPercent"].includes(fieldKey) && sectionRaw.royaltySourceType === "collective_agreement") return "agreement";
        return sources[sourceKey] ? "contract" : "unknown";
      };
      const evidenceButton = (fieldKey: string, label: string, text: string) => {
        const evidence = makeEvidence(fieldKey, label);
        return <button key={fieldKey} type="button" onClick={event => { event.stopPropagation(); props.onEvidenceActivate?.(evidence); }} className="inline-flex h-5 items-center gap-1 rounded-sm border bg-background px-1.5 text-[9.5px] font-medium hover:bg-muted">
          {text}
        </button>;
      };
      const rights = [
        triState(sectionValues.copydan) !== "no" && triState(sectionValues.copydan) !== "unknown" ? evidenceButton("copydan", "Copydan", "Copydan") : null,
        triState(sectionValues.svod) !== "no" && triState(sectionValues.svod) !== "unknown" ? evidenceButton("svod", "Streaming", "Streaming") : null,
        sectionValues.royalty === true || triState(sectionValues.royalty) === "yes" ? evidenceButton("royalty", "Royalty", `Royalty${sectionValues.royaltyPercent ? ` ${sectionValues.royaltyPercent} %` : ""}`) : null,
        sectionValues.hasCreditClause === true ? evidenceButton("hasCreditClause", "Krediteringsklausul", "Kreditering") : null,
      ].filter(Boolean);
      const unknownRights = ["copydan", "svod", "royalty", "hasCreditClause"].filter(key => {
        const value = sectionValues[key];
        return value === undefined || value === null || value === "" || value === "unknown";
      });
      const signatureState = triState(sectionValues.signatureStatus);
      const compactChoice = (key: string, label: string) => <div className="grid grid-cols-[1fr_110px] items-center gap-2"><Label className="text-xs">{label}</Label><select className="h-7 rounded-md border bg-background px-2 text-xs" value={triState(sectionValues[key])} onChange={event => setField(section, key, event.target.value)}><option value="unknown">Ukendt</option><option value="yes">Ja</option><option value="no">Nej</option><option value="implicit">Via overenskomst</option></select></div>;
      return <div className="divide-y divide-border/40">
        <div id="field-rights" onClick={event => activateEvidence(event, makeEvidence("copydan", "Rettigheder"))} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 px-2.5 py-0.5 transition-colors hover:bg-muted/50 ${props.activeEvidenceFieldKey === "copydan" || props.activeEvidenceFieldKey === "rights" ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500 dark:bg-amber-950/40 dark:ring-amber-500" : ""} ${unknownRights.length ? "bg-rose-500/10 border-l-2 border-l-rose-500 dark:bg-rose-950/20" : ""}`}>
          <div className="flex min-w-0 items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Label className="truncate text-[11px] font-medium text-foreground">Rettigheder</Label>{unknownRights.length > 0 && <Badge className="h-3.5 rounded-sm bg-rose-600 px-1 text-[7.5px] font-semibold text-white dark:bg-rose-700">{unknownRights.length}</Badge>}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-1">{rights.length ? rights : <span className="text-[11px] text-muted-foreground">Ingen registrerede rettigheder</span>}</div>
          <div className="flex items-center justify-end gap-1 shrink-0">
            <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]"><Pencil className="h-2.5 w-2.5" />Rediger</Button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-2">
              {compactChoice("copydan", "Copydan")}{compactChoice("svod", "Streaming")}
              <div className="grid grid-cols-[1fr_110px] items-center gap-2"><Label className="text-xs">Royalty</Label><CompactYesNo value={sectionValues.royalty} label="Royalty" onChange={next => setField(section, "royalty", next === "yes")} /></div>
              <div className="grid grid-cols-[1fr_110px] items-center gap-2"><Label className="text-xs">Royalty %</Label><Input className="h-7 text-xs" inputMode="decimal" value={String(sectionValues.royaltyPercent ?? "")} onChange={event => setField(section, "royaltyPercent", event.target.value)} /></div>
              <div className="grid grid-cols-[1fr_110px] items-center gap-2"><Label className="text-xs">Kreditering</Label><CompactYesNo value={sectionValues.hasCreditClause} label="Kreditering" onChange={next => setField(section, "hasCreditClause", next === "yes")} /></div>
            </PopoverContent></Popover>
            <button type="button" onClick={() => props.onEvidenceActivate?.(makeEvidence("copydan", "Rettigheder"))} title="Se kilde i PDF">
              <ContractSourceBadge source={sourceFor("copydan")} />
            </button>
          </div>
        </div>
        <div id="field-signature" onClick={event => activateEvidence(event, makeEvidence("signatureStatus", "Underskrift"))} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 px-2.5 py-0.5 transition-colors hover:bg-muted/50 ${props.activeEvidenceFieldKey === "signatureStatus" || props.activeEvidenceFieldKey === "signatureDate" ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500 dark:bg-amber-950/40 dark:ring-amber-500" : ""} ${signatureState === "unknown" ? "bg-rose-500/10 border-l-2 border-l-rose-500 dark:bg-rose-950/20" : ""}`}>
          <div className="flex min-w-0 items-center gap-1.5"><Signature className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Label className="truncate text-[11px] font-medium text-foreground">Underskrift</Label></div>
          <button type="button" onClick={() => props.onEvidenceActivate?.(makeEvidence("signatureStatus", "Underskrift"))} className="flex min-w-0 flex-wrap items-center gap-1.5 text-left">
            <Badge variant="outline" className={`h-5 rounded-sm px-1.5 text-[9.5px] font-medium ${signatureState === "yes" ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/20 dark:text-rose-100"}`}>{signatureState === "yes" ? "Underskrevet" : "Ikke underskrevet"}</Badge>
            {dates.contractDate && <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><CalendarDays className="h-2.5 w-2.5" />Kontrakt {dates.contractDate}</span>}
            {sectionValues.signatureDate && <span className="text-[10px] text-muted-foreground">Underskrift {String(sectionValues.signatureDate)}</span>}
          </button>
          <div className="flex items-center justify-end gap-1 shrink-0">
            <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]"><Pencil className="h-2.5 w-2.5" />Rediger</Button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-2">
              {compactChoice("signatureStatus", "Underskrevet")}
              <div className="space-y-1"><Label className="text-xs">Kontraktdato</Label><Input className="h-7 text-xs" type="date" value={dates.contractDate} onChange={event => props.onDatesChange?.({ ...dates, contractDate: event.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Underskriftsdato</Label><Input className="h-7 text-xs" type="date" value={String(sectionValues.signatureDate ?? "").slice(0, 10)} onChange={event => setField(section, "signatureDate", event.target.value)} /></div>
            </PopoverContent></Popover>
            <button type="button" onClick={() => props.onEvidenceActivate?.(makeEvidence("signatureStatus", "Underskrift"))} title="Se kilde i PDF">
              <ContractSourceBadge source={sourceFor("signatureStatus")} />
            </button>
          </div>
        </div>
      </div>;
    }
    const filteredFields = (FIELDS[section] ?? [])
      .filter(field => !props.includeFieldKeys || props.includeFieldKeys.includes(field.key))
      .filter(field => !props.excludeFieldKeys?.includes(field.key));
    const configuredFields = filteredFields.sort((left, right) => {
        const hasLeft = sectionValues[left.key] !== undefined && sectionValues[left.key] !== null && sectionValues[left.key] !== "";
        const hasRight = sectionValues[right.key] !== undefined && sectionValues[right.key] !== null && sectionValues[right.key] !== "";
        return Number(hasRight) - Number(hasLeft);
      });
    return <div className="space-y-0.5">
      {pensionTag && <div className={`rounded border px-2.5 py-1 text-xs mb-1 ${pensionStatus === "inferred_agreement" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : pensionStatus === "review_required" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" : "bg-muted/40"}`}>
        <div className="font-medium text-[11px]">{pensionTag}</div>
        {pensionUrl && <a className="text-[10px] underline underline-offset-2" href={pensionUrl} target="_blank" rel="noreferrer">Se den officielle kilde</a>}
      </div>}
      {configuredFields.map(field => {
      const sourceKey = SOURCE_KEYS[field.key] ?? field.key;
      const signatureEvidence = section === "signature" && typeof sectionRaw.signatureEvidence === "string"
        ? sectionRaw.signatureEvidence
        : null;
      const quote = sources[sourceKey] ?? (section === "signature" ? sources.signature ?? signatureEvidence : null);
      const locked = locks[section]?.has(field.key) ?? false;
      const value = field.key === "contractDate" ? dates.contractDate : sectionValues[field.key];
      const missingRequired = Boolean(props.requiredFieldKeys?.includes(field.key))
        && (value === undefined || value === null || value === "" || value === "unknown");
      const royaltyFromAgreement = ["royalty", "royaltyPercent"].includes(field.key)
        && sectionRaw.royaltySourceType === "collective_agreement";
      const source: ContractFieldSource = locked
        ? "manual"
        : royaltyFromAgreement
          ? "agreement"
          : field.key === "agreementReferenceStatus" || quote
            ? "contract"
            : field.readOnly
              ? "work_archive"
              : "unknown";
      const focusValue = evidenceFocusText(field, quote, value);
      const pageValue = sources[`${sourceKey}_page`];
      const evidence: ContractEvidenceActivation = {
        fieldKey: field.key,
        label: field.label,
        sourceKey,
        quote: quote ?? "",
        focusText: focusValue == null ? null : String(focusValue),
        clauseId: sources[`${sourceKey}_clause_id`] ?? null,
        page: pageValue && Number.isFinite(Number(pageValue)) ? Number(pageValue) : null,
      };
      return <div id={`field-${field.key}`} key={field.key} onClick={event => activateEvidence(event, evidence)} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 transition-colors hover:bg-muted/50 ${props.activeEvidenceFieldKey === field.key ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500 dark:bg-amber-950/40 dark:ring-amber-500" : ""} ${missingRequired ? "bg-rose-500/10 border-l-2 border-l-rose-500 dark:bg-rose-950/20" : ""}`}>
        <div className="flex min-w-0 items-center gap-1.5"><Label className="truncate text-[11px] font-medium text-foreground">{field.label}</Label>{missingRequired ? <Badge className="h-3.5 rounded-sm bg-rose-600 px-1 text-[7.5px] font-semibold text-white dark:bg-rose-700">Mangler</Badge> : null}</div>
        <div className="min-w-0">
        {field.type === "date" ? <Input className="h-6 text-[11px] px-2" type="date" value={dates.contractDate} onChange={event => props.onDatesChange?.({ ...dates, contractDate: event.target.value })} />
          : field.type === "textarea" ? <Textarea className="min-h-12 text-[11px] px-2 py-1" disabled={field.readOnly} value={String(sectionValues[field.key] ?? "")} onChange={event => setField(section, field.key, event.target.value)} />
          : field.type === "triState" ? <select className="h-6 w-full rounded border bg-background px-2 text-[11px] outline-none" value={triState(sectionValues[field.key])} onChange={event => setField(section, field.key, event.target.value)}><option value="unknown">Ukendt</option><option value="yes">Ja</option><option value="no">Nej</option>{field.key !== "agreementReferenceStatus" && <option value="implicit">Implicit via overenskomst</option>}</select>
          : field.type === "signatureMethod" ? <select className="h-6 w-full rounded border bg-background px-2 text-[11px] outline-none" value={String(sectionValues[field.key] || "unknown")} onChange={event => setField(section, field.key, event.target.value)}><option value="unknown">Ukendt</option><option value="handwritten">Håndskrevet</option><option value="digital">Digital</option><option value="none">Ingen</option></select>
          : field.type === "bool" ? <button type="button" onClick={() => setField(section, field.key, sectionValues[field.key] === undefined ? true : !sectionValues[field.key])} className={`h-6 w-full rounded border px-2 text-left text-[11px] ${sectionValues[field.key] === true ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : sectionValues[field.key] === false ? "bg-background text-foreground" : "border-rose-400/60 bg-rose-500/10 text-rose-900 dark:text-rose-200"}`}>{sectionValues[field.key] === undefined ? "Ikke vurderet" : sectionValues[field.key] ? "Ja" : "Nej"}</button>
          : <Input className="h-6 text-[11px] px-2" disabled={field.readOnly} inputMode={field.type === "number" ? "decimal" : undefined} value={String(sectionValues[field.key] ?? "")} onChange={event => setField(section, field.key, event.target.value)} />}
        </div>
        <div className="flex items-center justify-end gap-1 shrink-0">
          <button type="button" onClick={event => activateEvidence(event, evidence)} title="Se kilde i PDF">
            <ContractSourceBadge source={source} />
          </button>
          {!field.readOnly && <>
            {quote && !props.onEvidenceActivate && <SourceBtn quote={quote} active={props.activeHighlight === quote} onClick={() => props.onHighlightClick(quote)} />}
            <button type="button" title={locked ? "Feltet er låst for AI-overskrivning" : "Lås felt for AI-overskrivning"} aria-label={locked ? "Lås feltet op for AI-overskrivning" : "Beskyt feltet mod AI-overskrivning"} onClick={() => toggleLock(section, field.key)} className="p-0.5 text-muted-foreground hover:text-foreground">
              {locked ? <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" /> : <Unlock className="h-3 w-3 opacity-30" />}
            </button>
          </>}
        </div>
      </div>;
    })}</div>;
  };

  const renderSection = (section: ContractValidationSectionKey) => {
    if (section === "dates") return <div className="space-y-0.5">{[
      ["startDate", "Startdato", dates.startDate],
      ["endDate", "Slutdato", dates.endDate],
    ].map(([key, label, value]) => {
      const dateSources = (rawData.dates?._sources as Record<string, string | null> | undefined) ?? {};
      const quote = dateSources[key] ?? dateSources.dates ?? null;
      const pageValue = dateSources[`${key}_page`] ?? dateSources.dates_page;
      const evidence: ContractEvidenceActivation = { fieldKey: key, label, sourceKey: key, quote: quote ?? "", focusText: value, clauseId: dateSources[`${key}_clause_id`] ?? dateSources.dates_clause_id ?? null, page: pageValue && Number.isFinite(Number(pageValue)) ? Number(pageValue) : null };
      return <div key={key} onClick={event => activateEvidence(event, evidence)} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 transition-colors hover:bg-muted/50 last:border-b-0 ${props.activeEvidenceFieldKey === key ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500 dark:bg-amber-950/40 dark:ring-amber-500" : ""}`}>
      <Label className="truncate text-[11px] font-medium text-foreground">{label}</Label>
      <Input className="h-6 text-[11px] px-2" type="date" value={value} onChange={event => props.onDatesChange?.({ ...dates, [key]: event.target.value })} />
      <div className="flex items-center justify-end gap-1 shrink-0">
        <button type="button" onClick={event => activateEvidence(event, evidence)} title="Se kilde i PDF">
          <ContractSourceBadge source={quote ? "contract" : "unknown"} />
        </button>
      </div>
    </div>})}</div>;
    if (section === "series") return <div className="space-y-2">
      <SeasonStepper value={season} onChange={value => props.onSeasonChange?.(value)} compact />
      {props.episodesLoading || loading.has("series") ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Henter afsnit…</div>
        : props.episodesError ? <p className="text-xs text-destructive">{props.episodesError}</p>
        : <SeriesEpisodeSelector season={season} onSeasonChange={value => props.onSeasonChange?.(value)} options={props.episodeOptions ?? []} selected={props.selectedEpisodes ?? []} onSelectedChange={values => props.onSelectedEpisodesChange?.(values)} showSeason={false} compact />}
      {renderFields(section)}
    </div>;
    if (section === "ids") {
      const sectionValues = values.ids ?? {};
      const hasExternalId = ["dfiId", "tmdbId", "imdbId"].some(key => String(sectionValues[key] ?? "").trim());
      return <div>{[["dfiId", "DFI-id"], ["tmdbId", "TMDB-id"], ["imdbId", "IMDb-id"]].map(([key, label]) => <div key={key} className="grid min-h-[30px] grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 hover:bg-muted/50 transition-colors"><Label className="truncate text-[11px] font-medium text-foreground">{label}</Label><Input readOnly value={String(sectionValues[key] ?? "")} className="h-6 text-[11px] px-2 bg-muted/30" /><div className="flex items-center justify-end gap-1 shrink-0"><ContractSourceBadge source={sectionValues[key] ? "work_archive" : "unknown"} /></div></div>)}{!hasExternalId && <div className="p-2"><Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={findingIds} onClick={async () => { setFindingIds(true); try { const result = await findContractWorkExternalIds(props.contractId); if (!result.success || !result.ids) toast.error(result.error ?? "ID-opslaget gav intet sikkert match"); else { setValues(current => ({ ...current, ids: { ...(current.ids ?? {}), ...result.ids } })); toast.success("Eksterne ID’er blev fundet og gemt"); } } finally { setFindingIds(false); } }}>{findingIds && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Find ID’er i eksterne databaser</Button></div>}</div>;
    }
    if (section === "work") return <div>
      <div onClick={event => {
        const sources = ((rawData.work?._sources ?? {}) as Record<string, string | null>);
        const quote = sources.workTitle;
        activateEvidence(event, { fieldKey: "workingTitle", label: "Arbejdstitel", sourceKey: "workTitle", quote: quote ?? "", focusText: props.workingTitle, clauseId: sources.workTitle_clause_id ?? null, page: sources.workTitle_page && Number.isFinite(Number(sources.workTitle_page)) ? Number(sources.workTitle_page) : null });
      }} className={`grid min-h-[30px] cursor-pointer grid-cols-[130px_minmax(0,1fr)_130px] items-center gap-2 border-b border-border/40 px-2.5 py-0.5 transition-colors hover:bg-muted/50 ${props.activeEvidenceFieldKey === "workingTitle" ? "bg-amber-500/10 ring-1 ring-inset ring-amber-400/40 dark:bg-amber-950/30" : ""}`}>
        <Label className="truncate text-[11px] font-medium text-foreground">Arbejdstitel</Label><Input className="h-6 text-[11px] px-2" value={props.workingTitle ?? ""} placeholder="Produktionens arbejdstitel…" onChange={event => props.onWorkingTitleChange?.(event.target.value)} /><div className="flex items-center justify-end gap-1 shrink-0"><ContractSourceBadge source={props.workingTitle ? "contract" : "unknown"} /></div>
      </div>
      {renderFields(section)}
    </div>;
    return renderFields(section);
  };

  const sections = useMemo(() => SECTION_ORDER.filter(section => section.key !== "series" || props.isSeries), [props.isSeries]);
  if (props.section && props.bare) {
    if (loading.has(props.section) && !values[props.section]) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Henter data…</div>;
    if (errors[props.section]) return <div className="space-y-2 p-4"><p className="text-sm text-destructive">{errors[props.section]}</p><Button type="button" variant="outline" size="sm" onClick={() => void loadSection(props.section!)}>Prøv igen</Button></div>;
    return <div className="p-1">{renderSection(props.section)}</div>;
  }
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
