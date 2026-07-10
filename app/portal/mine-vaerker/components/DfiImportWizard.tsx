"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "./Modal";
import { importApprovedOnboardingWorks, searchNewCreditsForCurrentMember, type OnboardingCredit } from "@/app/actions/dfi";
import { useI18n } from "@/lib/i18n";

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

  const [wizardStep, setWizardStep]         = useState<"search" | "credits">("search");
  const [wizardQuery, setWizardQuery]       = useState(userName);
  const [wizardCredits, setWizardCredits]   = useState<OnboardingCredit[]>([]);
  const [wizardSelected, setWizardSelected] = useState<Record<string, boolean>>({});
  const [wizardDfiPersonId, setWizardDfiPersonId] = useState<number | null>(dfiPersonId);
  const [wizardTmdbPersonId, setWizardTmdbPersonId] = useState<number | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  const [seriesSeasons, setSeriesSeasons] = useState<Record<string, number>>({});
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, number[]>>({});
  const [wizardSkippedExistingCount, setWizardSkippedExistingCount] = useState(0);
  const [wizardSearching, setWizardSearching] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardError, setWizardError]       = useState<string | null>(null);
  const [wizardValidationError, setWizardValidationError] = useState<string | null>(null);

  const isSeriesCredit = (credit: OnboardingCredit) => {
    const raw = credit.raw ?? {};
    const text = `${credit.category} ${raw.media_type ?? ""} ${raw.type ?? ""} ${raw.Type ?? ""}`.toLowerCase();
    return text.includes("serie") || text.includes("tv");
  };

  const episodeCountForCredit = (credit: OnboardingCredit) => {
    const raw = credit.raw ?? {};
    const rawCount = raw.number_of_episodes ?? raw.episode_count ?? raw.EpisodeCount;
    const parsed = Number(rawCount);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 80);
    return 10;
  };

  const selectedEpisodesForCredit = (credit: OnboardingCredit) => {
    const count = episodeCountForCredit(credit);
    return seriesEpisodes[credit.id] ?? Array.from({ length: count }, (_, index) => index + 1);
  };

  const toggleEpisode = (credit: OnboardingCredit, episodeNumber: number) => {
    setSeriesEpisodes(prev => {
      const current = selectedEpisodesForCredit(credit);
      const next = current.includes(episodeNumber)
        ? current.filter(number => number !== episodeNumber)
        : [...current, episodeNumber].sort((a, b) => a - b);
      return { ...prev, [credit.id]: next };
    });
  };

  const loadWizardCredits = useCallback(async (query: string) => {
    setWizardSearching(true);
    setWizardError(null);
    setWizardValidationError(null);
    const res = await searchNewCreditsForCurrentMember(query);
    if (res.success) {
      const newCredits = res.credits ?? [];
      setWizardCredits(newCredits);
      setWizardDfiPersonId(res.dfiPersonId ?? null);
      setWizardTmdbPersonId(res.tmdbPersonId ?? null);
      setWizardSkippedExistingCount(res.skippedAlreadyAssignedCount ?? 0);
      const sel: Record<string, boolean> = {};
      newCredits.forEach((c: OnboardingCredit) => {
        if (c.id) sel[c.id] = true;
      });
      setWizardSelected(sel);
    } else {
      setWizardError(res.error ?? "Kunne ikke finde nye titler.");
    }
    setWizardSearching(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWizardQuery(userName);
      setWizardCredits([]);
      setWizardSelected({});
      setExpandedSeries({});
      setSeriesSeasons({});
      setSeriesEpisodes({});
      setWizardError(null);
      setWizardValidationError(null);
      setWizardSkippedExistingCount(0);
      setWizardDfiPersonId(dfiPersonId);
      setWizardTmdbPersonId(null);
      if (dfiPersonId) {
        setWizardStep("credits");
        loadWizardCredits(userName);
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
    setWizardError(null);
    setWizardValidationError(null);
    setWizardStep("credits");
    await loadWizardCredits(wizardQuery);
  };

  const handleWizardImport = async () => {
    const approved = wizardCredits
      .filter(c => wizardSelected[c.id])
      .map(c => isSeriesCredit(c)
        ? { ...c, season_number: seriesSeasons[c.id] ?? 1, selected_episodes: selectedEpisodesForCredit(c) }
        : c
      );
    if (!approved.length) {
      setWizardValidationError(t("works.chooseAtLeastOne"));
      return;
    }
    if (approved.some(c => isSeriesCredit(c) && (!c.selected_episodes || c.selected_episodes.length === 0))) {
      setWizardValidationError("Vælg mindst ét afsnit for hver serie, du vil importere.");
      return;
    }
    setWizardImporting(true);
    setWizardError(null);
    setWizardValidationError(null);
    const res = await importApprovedOnboardingWorks(wizardDfiPersonId, wizardTmdbPersonId, approved);
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
        <h2 className="text-lg font-semibold text-foreground">{t("works.importFromDfi")}</h2>
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
                <div className="text-sm text-muted-foreground">
                  <p>Fandt {wizardCredits.length} nye titler. Vælg dem, du vil importere.</p>
                  {wizardSkippedExistingCount > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {wizardSkippedExistingCount} titel{wizardSkippedExistingCount === 1 ? "" : "r"} var allerede på din liste og blev sprunget over.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    const all = Object.values(wizardSelected).every(v => v);
                    const s: Record<string, boolean> = {};
                    wizardCredits.forEach(c => {
                      s[c.id] = !all;
                    });
                    setWizardSelected(s);
                    setWizardValidationError(null);
                  }}
                  className="w-full text-xs px-2.5 py-1 rounded-md border hover:bg-muted text-muted-foreground sm:w-auto"
                >
                  {Object.values(wizardSelected).every(v => v) ? t("works.deselectAll") : t("works.selectAll")}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
                {wizardCredits.map((c, i) => {
                  const isSeries = isSeriesCredit(c);
                  const episodeCount = episodeCountForCredit(c);
                  const selectedEpisodes = selectedEpisodesForCredit(c);
                  return (
                    <div
                      key={`${c.id}-${i}`}
                      className={`px-4 py-3 transition-colors ${
                        wizardSelected[c.id] ? "bg-muted/60" : "hover:bg-muted/50"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={wizardSelected[c.id] || false}
                          onChange={e => {
                            setWizardSelected(prev => ({ ...prev, [c.id]: e.target.checked }));
                            setWizardValidationError(null);
                          }}
                          className="mt-0.5 w-4 h-4 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {c.title} {c.year ? `(${c.year})` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="font-medium">{c.role}</span> · {c.category} · {c.source.toUpperCase()}
                            {c.imdb_id ? ` · IMDb ${c.imdb_id}` : ""}
                          </p>
                        </div>
                      </label>
                      {isSeries && wizardSelected[c.id] && (
                        <div className="mt-3 ml-7 rounded-md border bg-background p-3">
                          <button
                            type="button"
                            className="text-sm font-medium text-foreground"
                            onClick={() => setExpandedSeries(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                          >
                            {expandedSeries[c.id] ? "Skjul afsnit" : "Vælg afsnit"} · {selectedEpisodes.length} valgt
                          </button>
                          {expandedSeries[c.id] && (
                            <div className="mt-3 space-y-3">
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                Sæson
                                <Input
                                  type="number"
                                  min="1"
                                  value={seriesSeasons[c.id] ?? 1}
                                  onChange={event => setSeriesSeasons(prev => ({ ...prev, [c.id]: Math.max(1, Number(event.target.value) || 1) }))}
                                  className="h-8 w-20"
                                />
                              </label>
                              <div className="sticky top-0 z-10 grid grid-cols-2 gap-2 bg-background py-1 sm:flex">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs"
                                  onClick={() => setSeriesEpisodes(prev => ({ ...prev, [c.id]: Array.from({ length: episodeCount }, (_, index) => index + 1) }))}
                                >
                                  Vælg alle
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs"
                                  onClick={() => setSeriesEpisodes(prev => ({ ...prev, [c.id]: [] }))}
                                >
                                  Fravælg alle
                                </Button>
                              </div>
                              <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                                {Array.from({ length: episodeCount }, (_, index) => index + 1).map(episodeNumber => {
                                  const checked = selectedEpisodes.includes(episodeNumber);
                                  return (
                                    <button
                                      key={episodeNumber}
                                      type="button"
                                      className={`rounded-md border px-2 py-2 text-left text-xs ${
                                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                                      }`}
                                      onClick={() => toggleEpisode(c, episodeNumber)}
                                    >
                                      Afsnit {episodeNumber}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
