"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "./Modal";
import { searchDFIPerson, getDFIPersonCredits, importApprovedDFIWorks, prepareDFIImportCredits } from "@/app/actions/dfi";
import { useI18n } from "@/lib/i18n";

interface DfiSearchResult {
  Id: number;
  Title?: string;
  ReleaseYear?: number;
  ProductionYear?: number;
  Category?: string;
  Description?: string;
  Type?: string;
}

interface DfiPersonResult {
  Id: number;
  Name?: string;
  FirstName?: string;
  LastName?: string;
  BirthYear?: number | string | null;
}

interface DfiImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  dfiPersonId: number | null;
  onImportComplete: (message: string, success: boolean) => void;
  reloadAssignments: () => Promise<void>;
}

export function DfiImportWizard({
  isOpen,
  onClose,
  userName,
  dfiPersonId,
  onImportComplete,
  reloadAssignments,
}: DfiImportWizardProps) {
  const { t } = useI18n();

  const [wizardStep, setWizardStep]         = useState<"search" | "persons" | "credits">("search");
  const [wizardQuery, setWizardQuery]       = useState(userName);
  const [wizardPersons, setWizardPersons]   = useState<DfiPersonResult[]>([]);
  const [wizardPerson, setWizardPerson]     = useState<DfiPersonResult | null>(null);
  const [wizardCredits, setWizardCredits]   = useState<DfiSearchResult[]>([]);
  const [wizardSelected, setWizardSelected] = useState<Record<number, boolean>>({});
  const [wizardLinkedExistingCount, setWizardLinkedExistingCount] = useState(0);
  const [wizardSkippedExistingCount, setWizardSkippedExistingCount] = useState(0);
  const [wizardSearching, setWizardSearching] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardError, setWizardError]       = useState<string | null>(null);
  const [wizardValidationError, setWizardValidationError] = useState<string | null>(null);

  const loadWizardCredits = useCallback(async (personId: number) => {
    setWizardSearching(true);
    setWizardError(null);
    setWizardValidationError(null);
    const res = await getDFIPersonCredits(personId);
    if (res.success && res.credits) {
      const unique = (res.credits as DfiSearchResult[]).filter((c, i, arr) => arr.findIndex(x => x.Id === c.Id) === i);
      const prepared = await prepareDFIImportCredits(personId, unique);
      const newCredits: DfiSearchResult[] = prepared.success ? ((prepared.credits ?? []) as DfiSearchResult[]) : unique;
      setWizardCredits(newCredits);
      setWizardLinkedExistingCount(prepared.linkedExistingCount ?? 0);
      setWizardSkippedExistingCount(prepared.skippedAlreadyAssignedCount ?? 0);
      const sel: Record<number, boolean> = {};
      newCredits.forEach((c: DfiSearchResult) => {
        if (c.Id != null) sel[Number(c.Id)] = true;
      });
      setWizardSelected(sel);
      if (prepared.success && (prepared.linkedExistingCount ?? 0) > 0) {
        await reloadAssignments();
      }
      if (!prepared.success) {
        setWizardError(prepared.error ?? "Kunne ikke tjekke lokale værker før import.");
      }
    } else {
      setWizardError(res.error ?? "Kunne ikke hente krediteringer.");
    }
    setWizardSearching(false);
  }, [reloadAssignments]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWizardQuery(userName);
      setWizardPersons([]);
      setWizardPerson(null);
      setWizardCredits([]);
      setWizardSelected({});
      setWizardError(null);
      setWizardValidationError(null);
      setWizardLinkedExistingCount(0);
      setWizardSkippedExistingCount(0);
      if (dfiPersonId) {
        setWizardStep("credits");
        loadWizardCredits(dfiPersonId);
      } else {
        setWizardStep("search");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, userName, dfiPersonId, loadWizardCredits]);

  const handleWizardSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizardQuery.trim()) return;
    setWizardSearching(true);
    setWizardError(null);
    setWizardValidationError(null);
    const res = await searchDFIPerson(undefined, undefined, wizardQuery);
    if (res.success && res.results?.length) {
      const persons = res.results as DfiPersonResult[];
      if (res.results.length === 1) {
        setWizardPerson(persons[0]);
        setWizardStep("credits");
        loadWizardCredits(persons[0].Id);
      } else {
        setWizardPersons(persons);
        setWizardStep("persons");
      }
    } else {
      setWizardError(res.error ?? `Ingen personer fundet med "${wizardQuery}".`);
    }
    setWizardSearching(false);
  };

  const handleWizardImport = async () => {
    const approved = wizardCredits.filter(c => wizardSelected[c.Id]);
    if (!approved.length) {
      setWizardValidationError(t("works.chooseAtLeastOne"));
      return;
    }
    const personId = wizardPerson?.Id ?? dfiPersonId;
    if (!personId) return;
    setWizardImporting(true);
    setWizardError(null);
    setWizardValidationError(null);
    const res = await importApprovedDFIWorks(personId, approved);
    if (res.success) {
      const linkedCount = res.linkedExistingCount ?? 0;
      const importedText = t("works.importedFromDfi").replace("{count}", String(res.importedCount));
      const message = linkedCount > 0
        ? `${importedText} ${linkedCount} eksisterende titel${linkedCount === 1 ? "" : "r"} blev tilføjet fra databasen.`
        : importedText;
      onImportComplete(message, true);
      await reloadAssignments();
    } else {
      setWizardError(res.errors?.join(", ") ?? t("works.importFailed"));
    }
    setWizardImporting(false);
  };

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{t("works.importFromDfi")}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
      </div>

      {wizardStep === "search" && (
        <form onSubmit={handleWizardSearch} className="space-y-4">
          <p className="text-sm text-gray-500">{t("works.dfiIntro")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={wizardQuery}
              onChange={e => setWizardQuery(e.target.value)}
              placeholder={t("works.namePlaceholder")}
            />
            <Button type="submit" disabled={wizardSearching} className="w-full gap-1.5 shrink-0 sm:w-auto">
              {wizardSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {t("common.searchButton")}
            </Button>
          </div>
          {wizardError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              {wizardError}
            </div>
          )}
        </form>
      )}

      {wizardStep === "persons" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            {t("works.foundPersons").replace("{count}", String(wizardPersons.length))}
          </p>
          {wizardPersons.map(p => (
            <button
              key={p.Id}
              onClick={() => {
                setWizardPerson(p);
                setWizardStep("credits");
                loadWizardCredits(p.Id);
              }}
              className="w-full text-left px-4 py-3 rounded-md border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <p className="font-medium text-gray-900">{p.Name || `${p.FirstName} ${p.LastName}`}</p>
              {p.BirthYear && <p className="text-xs text-gray-500">f. {p.BirthYear}</p>}
            </button>
          ))}
        </div>
      )}

      {wizardStep === "credits" && (
        <div>
          {wizardSearching ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <p className="text-sm text-gray-500">{t("works.loadingCredits")}</p>
            </div>
          ) : wizardError ? (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              {wizardError}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-500">
                  <p>Fandt {wizardCredits.length} nye titler. Vælg dem, du vil importere.</p>
                  {(wizardLinkedExistingCount > 0 || wizardSkippedExistingCount > 0) && (
                    <p className="mt-1 text-xs text-gray-400">
                      {wizardLinkedExistingCount > 0 &&
                        `${wizardLinkedExistingCount} eksisterende titel${wizardLinkedExistingCount === 1 ? "" : "r"} blev tilføjet fra databasen.`}
                      {wizardSkippedExistingCount > 0 &&
                        ` ${wizardSkippedExistingCount} titel${wizardSkippedExistingCount === 1 ? "" : "r"} var allerede på din liste.`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    const all = Object.values(wizardSelected).every(v => v);
                    const s: Record<number, boolean> = {};
                    wizardCredits.forEach(c => {
                      s[c.Id] = !all;
                    });
                    setWizardSelected(s);
                    setWizardValidationError(null);
                  }}
                  className="w-full text-xs px-2.5 py-1 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-600 sm:w-auto"
                >
                  {Object.values(wizardSelected).every(v => v) ? t("works.deselectAll") : t("works.selectAll")}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {wizardCredits.map((c, i) => (
                  <label
                    key={`${c.Id}-${i}`}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      wizardSelected[c.Id] ? "bg-gray-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={wizardSelected[c.Id] || false}
                      onChange={e => {
                        setWizardSelected(prev => ({ ...prev, [c.Id]: e.target.checked }));
                        setWizardValidationError(null);
                      }}
                      className="mt-0.5 w-4 h-4 accent-gray-900"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {c.Title} {c.ReleaseYear ? `(${c.ReleaseYear})` : ""}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="font-medium">{c.Description || c.Type}</span> · {c.Category}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              {wizardValidationError && (
                <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
                  {wizardValidationError}
                </div>
              )}
              <div className="flex justify-end mt-4">
                <Button onClick={handleWizardImport} disabled={wizardImporting} className="w-full gap-2 sm:w-auto">
                  {wizardImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {wizardImporting
                    ? t("works.importing")
                    : t("works.importCount").replace(
                        "{count}",
                        String(Object.values(wizardSelected).filter(Boolean).length)
                      )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
