"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  selectionKey,
  uniqueCompanySelections,
  type LegalEntityKind,
  type ProductionCompanyOption,
  type ProductionCompanySelection,
} from "@/lib/production-companies";
import { useI18n } from "@/lib/i18n";

type Props = {
  value: ProductionCompanySelection[];
  onChange: (value: ProductionCompanySelection[]) => void;
  disabled?: boolean;
  label?: string;
  suggestedName?: string;
};

export function ProductionCompanyPicker({ value, onChange, disabled = false, label, suggestedName = "" }: Props) {
  const { locale } = useI18n();
  const da = locale === "da";
  const [query, setQuery] = useState(suggestedName);
  const [options, setOptions] = useState<ProductionCompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingCanonical, setCreatingCanonical] = useState(false);
  const [legalFor, setLegalFor] = useState<ProductionCompanyOption | null>(null);
  const [legalName, setLegalName] = useState("");
  const [cvr, setCvr] = useState("");
  const [entityKind, setEntityKind] = useState<LegalEntityKind>("company");
  const [savingLegal, setSavingLegal] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/production-companies?query=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        setOptions(json.data ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setOptions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const selected = useMemo(() => new Set(value.map(selectionKey)), [value]);
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
        ? (da ? "Det eksisterende selskab blev valgt." : "The existing company was selected.")
        : (da ? "Produktionsselskabet blev oprettet." : "The production company was created."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Selskabet kunne ikke oprettes." : "The company could not be created."));
    } finally {
      setCreatingCanonical(false);
    }
  }

  async function lookUpCvr() {
    const normalized = cvr.replace(/\D/g, "");
    if (normalized.length !== 8) {
      toast.error(da ? "Et CVR-nummer skal bestå af 8 cifre." : "A CVR number must contain 8 digits.");
      return;
    }
    try {
      const response = await fetch(`/api/cvr?cvr=${normalized}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setLegalName(json.legalName ?? json.navn ?? legalName);
      toast.success(da ? "CVR-oplysninger blev fundet. Kontrollér dem før lagring." : "CVR details found. Verify them before saving.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "CVR kunne ikke slås op." : "CVR lookup failed."));
    }
  }

  async function saveLegalEntity() {
    if (!legalFor || !legalName.trim()) return;
    setSavingLegal(true);
    try {
      const response = await fetch("/api/production-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "legal_entity",
          employerId: legalFor.employerId,
          legalName,
          registrationCountry: "DK",
          registrationType: "CVR",
          registrationNumber: cvr,
          entityKind,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      addSelection({
        employerId: legalFor.employerId,
        legalEntityId: json.data.id,
        canonicalName: legalFor.canonicalName,
        legalName: json.data.legal_name,
        registrationNumber: json.data.registration_number ?? undefined,
      });
      setLegalFor(null); setLegalName(""); setCvr(""); setEntityKind("company");
      toast.success(da ? "Den juridiske enhed blev tilføjet." : "The legal entity was added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (da ? "Enheden kunne ikke tilføjes." : "The entity could not be added."));
    } finally {
      setSavingLegal(false);
    }
  }

  return <div className="space-y-2">
    <Label>{label ?? (da ? "Produktionsselskaber" : "Production companies")}</Label>
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

    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder={da ? "Søg navn, navnevariant eller CVR…" : "Search name, alias or registration…"} />
    </div>
    {(query.trim() || loading) && <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      {loading && <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{da ? "Søger…" : "Searching…"}</div>}
      {!loading && options.map(option => <div key={option.employerId} className="rounded-md border p-2">
        <div className="flex items-center gap-2">
          <button type="button" disabled={selected.has(`${option.employerId}:canonical`)} onClick={() => addSelection({ employerId: option.employerId, canonicalName: option.canonicalName })} className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-muted disabled:opacity-60">
            <span className="flex items-center gap-2 font-medium">{option.canonicalName}{option.isVerified && <Check className="h-3.5 w-3.5 text-emerald-600" />}</span>
            {option.aliases.length > 0 && <span className="block truncate text-xs text-muted-foreground">{option.aliases.join(" · ")}</span>}
          </button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setLegalFor(option); setLegalName(""); setCvr(""); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />{da ? "CVR" : "Entity"}
          </Button>
        </div>
        {option.legalEntities.map(entity => <button key={entity.id} type="button" disabled={selected.has(`${option.employerId}:${entity.id}`)} onClick={() => addSelection({ employerId: option.employerId, legalEntityId: entity.id, canonicalName: option.canonicalName, legalName: entity.legalName, registrationNumber: entity.registrationNumber ?? undefined })} className="mt-1 block w-full rounded border-l-2 px-3 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-60">
          {entity.legalName}{entity.registrationNumber ? ` · ${entity.registrationType} ${entity.registrationNumber}` : ""}
        </button>)}
      </div>)}
      {!loading && query.trim() && <Button type="button" variant="ghost" className="w-full justify-start" disabled={creatingCanonical} onClick={createCanonical}>
        {creatingCanonical ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        {da ? `Opret nyt produktionsselskab “${query.trim()}”` : `Create production company “${query.trim()}”`}
      </Button>}
    </div>}

    {legalFor && <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="text-sm font-medium">{da ? `Tilføj juridisk enhed under ${legalFor.canonicalName}` : `Add legal entity under ${legalFor.canonicalName}`}</p>
      <Input value={cvr} onChange={event => setCvr(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="CVR" />
      <Button type="button" size="sm" variant="outline" onClick={lookUpCvr}>{da ? "Slå CVR op" : "Look up CVR"}</Button>
      <Input value={legalName} onChange={event => setLegalName(event.target.value)} placeholder={da ? "Juridisk selskabsnavn" : "Legal company name"} />
      <select value={entityKind} onChange={event => setEntityKind(event.target.value as LegalEntityKind)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        <option value="company">{da ? "Selskab" : "Company"}</option>
        <option value="subsidiary">{da ? "Datterselskab" : "Subsidiary"}</option>
        <option value="spv">{da ? "Projekt-/SPV-selskab" : "Project/SPV company"}</option>
      </select>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={savingLegal || !legalName.trim()} onClick={saveLegalEntity}>{savingLegal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{da ? "Gem og vælg" : "Save and select"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setLegalFor(null)}>{da ? "Annuller" : "Cancel"}</Button>
      </div>
    </div>}
  </div>;
}
