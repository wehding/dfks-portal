"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  selectionKey,
  singleHighConfidenceCompanyMatch,
  uniqueCompanySelections,
  type ProductionCompanyOption,
  type ProductionCompanySelection,
} from "@/lib/production-companies";
import { useI18n } from "@/lib/i18n";

type CvrSearchResult = {
  name: string;
  cvrNumber: string;
  industryCode?: string | null;
  industryDescription?: string | null;
};

type Props = {
  value: ProductionCompanySelection[];
  onChange: (value: ProductionCompanySelection[]) => void;
  disabled?: boolean;
  label?: string;
  suggestedName?: string;
  suggestedNames?: string[];
  autoSelectHighConfidence?: boolean;
  canManageRegistry?: boolean;
};

export function ProductionCompanyPicker({ value, onChange, disabled = false, label, suggestedName = "", suggestedNames = [], autoSelectHighConfidence = false, canManageRegistry = false }: Props) {
  const { locale } = useI18n();
  const da = locale === "da";
  const [query, setQuery] = useState(suggestedName);
  const [options, setOptions] = useState<ProductionCompanyOption[]>([]);
  const [cvrOptions, setCvrOptions] = useState<CvrSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingCanonical, setCreatingCanonical] = useState(false);
  const [savingCvr, setSavingCvr] = useState<string | null>(null);
  const [contractSuggestions, setContractSuggestions] = useState<Array<{ sourceName: string; option: ProductionCompanyOption | null }>>([]);

  const suggestedNamesKey = `${suggestedName}\u0000${suggestedNames.join("\u0000")}`;
  const normalizedSuggestedNames = useMemo(() => [...new Set([suggestedName, ...suggestedNames].map(name => name.trim()).filter(Boolean))], [suggestedNamesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    const load = async () => {
      const results = await Promise.all(normalizedSuggestedNames.map(async sourceName => {
        try {
          const response = await fetch(`/api/production-companies?query=${encodeURIComponent(sourceName)}`);
          const json = await response.json();
          const option = response.ok ? ((json.data ?? []) as ProductionCompanyOption[])[0] ?? null : null;
          return { sourceName, option };
        } catch {
          return { sourceName, option: null };
        }
      }));
      if (!active) return;
      const seen = new Set<string>();
      setContractSuggestions(results.filter(item => {
        const key = item.option?.employerId ?? `unmatched:${item.sourceName.toLocaleLowerCase("da")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return !item.option || !value.some(selectedValue => selectedValue.employerId === item.option?.employerId);
      }));
    };
    void load();
    return () => { active = false; };
  }, [normalizedSuggestedNames, value]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const trimmed = query.trim();
      if (!trimmed) {
        setOptions([]);
        setCvrOptions([]);
        return;
      }
      setLoading(true);
      try {
        const localResponse = await fetch(`/api/production-companies?query=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const localJson = await localResponse.json();
        if (!localResponse.ok) throw new Error(localJson.error);
        const localOptions = (localJson.data ?? []) as ProductionCompanyOption[];
        setOptions(localOptions);
        if (!canManageRegistry || localOptions.length > 0 || trimmed.length < 2) {
          setCvrOptions([]);
          return;
        }

        const digits = trimmed.replace(/\D/g, "");
        const isCvr = /^\d{7,8}$/.test(digits) && !/[a-zæøå]/i.test(trimmed);
        const cvrResponse = await fetch(isCvr ? `/api/cvr?cvr=${digits}` : `/api/cvr?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const cvrJson = await cvrResponse.json();
        if (cvrResponse.status === 404) {
          setCvrOptions([]);
          return;
        }
        if (!cvrResponse.ok) throw new Error(cvrJson.error);
        setCvrOptions(isCvr
          ? [{ name: cvrJson.legalName ?? cvrJson.navn, cvrNumber: cvrJson.registrationNumber, industryCode: cvrJson.industryCode, industryDescription: cvrJson.industryDescription }]
          : (cvrJson.results ?? []));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setOptions([]);
          setCvrOptions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canManageRegistry, query]);

  const selected = useMemo(() => new Set(value.map(selectionKey)), [value]);

  useEffect(() => {
    if (!autoSelectHighConfidence || disabled || value.length > 0 || loading) return;
    const option = singleHighConfidenceCompanyMatch(options);
    if (!option) return;
    onChange([{
      employerId: option.employerId,
      canonicalName: option.canonicalName,
      matchScore: option.matchScore,
      matchMethod: option.matchMethod,
    }]);
    setQuery("");
  }, [autoSelectHighConfidence, disabled, loading, onChange, options, value.length]);

  const addSelection = (selection: ProductionCompanySelection) => {
    onChange(uniqueCompanySelections([...value, selection]));
    setQuery("");
  };
  const removeSelection = (selection: ProductionCompanySelection) => {
    onChange(value.filter(item => selectionKey(item) !== selectionKey(selection)));
  };

  async function createCanonical() {
    const name = query.trim();
    if (!name) return;
    setCreatingCanonical(true);
    try {
      const response = await fetch("/api/production-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "canonical", name }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      const option = json.data as ProductionCompanyOption;
      addSelection({ employerId: option.employerId, canonicalName: option.canonicalName });
      toast.success(json.existing
        ? (da ? "Den eksisterende producent blev valgt." : "The existing producer was selected.")
        : (da ? "Producenten blev oprettet." : "The producer was created."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Producenten kunne ikke oprettes." : "The producer could not be created."));
    } finally {
      setCreatingCanonical(false);
    }
  }

  async function selectCvrCompany(result: CvrSearchResult) {
    setSavingCvr(result.cvrNumber);
    try {
      const response = await fetch("/api/production-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cvr_company", cvrNumber: result.cvrNumber }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      const option = json.data as ProductionCompanyOption;
      const entity = option.legalEntities.find(item => item.registrationNumber === result.cvrNumber);
      addSelection({
        employerId: option.employerId,
        legalEntityId: entity?.id,
        canonicalName: option.canonicalName,
        legalName: entity?.legalName,
        registrationNumber: entity?.registrationNumber ?? undefined,
        matchMethod: "cvr",
      });
      toast.success(json.existing
        ? (da ? "Den eksisterende producent blev valgt." : "The existing producer was selected.")
        : (da ? "Producenten blev hentet fra CVR-registeret." : "The producer was imported from the company register."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Producenten kunne ikke hentes fra CVR-registeret." : "The producer could not be imported."));
    } finally {
      setSavingCvr(null);
    }
  }

  const showResults = Boolean(query.trim() || loading);
  return <div className="min-w-0 space-y-2">
    <Label>{label ?? (da ? "Producent" : "Producer")}</Label>
    {value.length > 0 && <div className="space-y-2">
      {value.map(selection => <div key={selectionKey(selection)} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2 text-sm">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{selection.canonicalName}</span>
          {selection.legalName && <span className="block text-xs text-muted-foreground">
            {selection.legalName}{selection.registrationNumber ? ` · CVR ${selection.registrationNumber}` : ""}
          </span>}
        </span>
        <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={() => removeSelection(selection)} aria-label={da ? `Fjern ${selection.canonicalName}` : `Remove ${selection.canonicalName}`}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>)}
    </div>}

    {contractSuggestions.length > 0 && <div className="space-y-1 rounded-md border border-dashed p-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">{da ? "Aflæst fra kontrakten" : "Read from the contract"}</p>
      {contractSuggestions.map(item => item.option ? <button
        key={`${item.sourceName}:${item.option.employerId}`}
        type="button"
        disabled={disabled}
        onClick={() => addSelection({ employerId: item.option!.employerId, canonicalName: item.option!.canonicalName, matchScore: item.option!.matchScore, matchMethod: "admin" })}
        className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
      >
        <span className="block font-medium">{item.option.canonicalName}</span>
        <span className="block text-xs text-muted-foreground">{item.sourceName}{item.option.matchScore != null ? ` · ${Math.min(100, item.option.matchScore)}% match` : ""}</span>
      </button> : <button key={item.sourceName} type="button" disabled={disabled} onClick={() => setQuery(item.sourceName)} className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
        <span className="block font-medium">{item.sourceName}</span>
        <span className="block text-xs text-muted-foreground">{canManageRegistry
          ? (da ? "Ikke fundet — søg eller opret" : "Not found — search or create")
          : (da ? "Ikke fundet — kontakt en administrator for at få producenten oprettet" : "Not found — contact an administrator to add the producer")}</span>
      </button>)}
    </div>}

    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder={da ? "Tilføj producent" : "Add producer"} />
    </div>
    {showResults && <div className="max-h-72 min-w-0 space-y-1 overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      {loading && <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{da ? "Søger lokalt og i CVR-registeret…" : "Searching locally and in the company register…"}</div>}
      {!loading && options.map(option => <div key={option.employerId} className="min-w-0 rounded-md border p-1">
        <button type="button" disabled={selected.has(`${option.employerId}:canonical`)} onClick={() => addSelection({ employerId: option.employerId, canonicalName: option.canonicalName, matchScore: option.matchScore, matchMethod: "admin" })} className="block w-full min-w-0 rounded px-2 py-2 text-left hover:bg-muted disabled:opacity-60">
          <span className="flex min-w-0 items-start gap-2 break-words font-medium"><span className="min-w-0 flex-1">{option.canonicalName}</span>{option.isVerified && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}</span>
          {option.aliases.length > 0 && <span className="block truncate text-xs text-muted-foreground">{option.aliases.join(" · ")}</span>}
          {query.trim() && option.matchScore != null && <span className="block text-xs text-muted-foreground">{option.matchMethod === "exact_name" ? (da ? "Eksakt navnematch" : "Exact name match") : `${da ? "Muligt fuzzy match" : "Possible fuzzy match"} · ${Math.min(100, option.matchScore)}%`}</span>}
        </button>
        {option.legalEntities.map(entity => <button key={entity.id} type="button" disabled={selected.has(`${option.employerId}:${entity.id}`)} onClick={() => addSelection({ employerId: option.employerId, legalEntityId: entity.id, canonicalName: option.canonicalName, legalName: entity.legalName, registrationNumber: entity.registrationNumber ?? undefined })} className="mt-1 block w-full min-w-0 break-words rounded border-l-2 px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-60">
          {entity.legalName}{entity.registrationNumber ? ` · CVR ${entity.registrationNumber}` : ""}
        </button>)}
      </div>)}
      {!loading && canManageRegistry && cvrOptions.map(result => <button key={result.cvrNumber} type="button" disabled={savingCvr !== null} onClick={() => void selectCvrCompany(result)} className="block w-full min-w-0 rounded-md border border-dashed px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60">
        <span className="flex items-center gap-2 font-medium">{savingCvr === result.cvrNumber && <Loader2 className="h-4 w-4 animate-spin" />}{result.name}</span>
        <span className="block text-xs text-muted-foreground">CVR {result.cvrNumber}{result.industryDescription ? ` · ${result.industryDescription}` : ""}</span>
        <span className="block text-xs text-muted-foreground">{da ? "Fundet i CVR-registeret" : "Found in the company register"}</span>
      </button>)}
      {!loading && canManageRegistry && query.trim() && options.length === 0 && cvrOptions.length === 0 && <Button type="button" variant="ghost" className="h-auto w-full min-w-0 justify-start whitespace-normal py-2 text-left" disabled={creatingCanonical} onClick={createCanonical}>
        {creatingCanonical ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        {da ? `Opret ny producent “${query.trim()}”` : `Create producer “${query.trim()}”`}
      </Button>}
      {!loading && !canManageRegistry && query.trim() && options.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">
        {da ? "Producenten findes ikke i registret. En administrator skal oprette den, før den kan vælges." : "The producer is not in the registry. An administrator must add it before it can be selected."}
      </p>}
    </div>}
  </div>;
}
