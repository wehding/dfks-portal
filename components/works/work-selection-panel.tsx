"use client";

import type { ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualWorkFormFields } from "@/components/works/manual-work-form";
import type { UnifiedSearchWorkResult } from "@/app/actions/member-works";
import type { ManualWorkFormValue } from "@/lib/manual-work";
import { WORK_TYPES } from "@/lib/work-types";
import { useI18n } from "@/lib/i18n";

const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-input/30";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  hasSearched: boolean;
  searchError?: string | null;
  results: UnifiedSearchWorkResult[];
  selectedId?: string | null;
  onSelect: (result: UnifiedSearchWorkResult) => void;
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
  manualMode: boolean;
  onManualModeChange: (manual: boolean) => void;
  manualWork: ManualWorkFormValue;
  onManualWorkChange: (work: ManualWorkFormValue) => void;
  locale: string;
  manualExtra?: ReactNode;
  renderSelectedDetails?: (result: UnifiedSearchWorkResult) => ReactNode;
  autoFocus?: boolean;
};

function typeLabel(type: string, locale: string) {
  if (locale !== "en") return WORK_TYPES.find(item => item.value === type)?.label ?? "Andet";
  const english: Record<string, string> = {
    spillefilm: "Feature Film",
    kortfilm: "Short Film",
    "tv-serie": "TV Series",
    dokumentarfilm: "Documentary",
    "dokumentar-serie": "Docu-Series",
    dokudrama: "Docudrama",
  };
  return english[type] ?? "Other";
}

export function WorkSelectionPanel({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  hasSearched,
  searchError,
  results,
  selectedId,
  onSelect,
  typeFilter,
  onTypeFilterChange,
  manualMode,
  onManualModeChange,
  manualWork,
  onManualWorkChange,
  locale,
  manualExtra,
  renderSelectedDetails,
  autoFocus = false,
}: Props) {
  const { t } = useI18n();
  const filteredResults = results.filter(item => typeFilter === "all" || item.type === typeFilter);
  const enterManual = () => {
    if (!manualWork.title.trim() && query.trim()) {
      onManualWorkChange({ ...manualWork, title: query.trim() });
    }
    onManualModeChange(true);
  };

  return (
    <div className="space-y-4">
      {!manualMode ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              autoFocus={autoFocus}
              placeholder={t("works.addSearchPlaceholder")}
              value={query}
              onChange={event => onQueryChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") onSearch();
              }}
            />
            <select value={typeFilter} onChange={event => onTypeFilterChange(event.target.value)} className={`${selectCls} sm:w-48`}>
              <option value="all">Type</option>
              {WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={onSearch} disabled={isSearching || !query.trim()} className="w-full shrink-0 gap-1.5 sm:w-auto">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t("common.searchButton")}
            </Button>
          </div>

          {searchError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {searchError}
            </div>
          )}

          {results.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {locale === "da" ? "Søgeresultater" : "Search results"} ({filteredResults.length})
              </p>
              <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto pr-1">
                {filteredResults.map(item => {
                  const selected = selectedId === item.id;
                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                      >
                        {item.poster_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.poster_url} alt="" className="h-11 w-8 shrink-0 rounded object-cover" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-semibold text-foreground">{item.title}</p>
                            <div className="flex gap-1">
                              {item.sources.map(source => (
                                <span key={source} className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${source === "local" ? "bg-amber-100 text-amber-800" : source === "dfi" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}>
                                  {source === "local" ? (locale === "da" ? "Findes allerede" : "Already exists") : source}
                                </span>
                              ))}
                            </div>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.year ?? "-"} · {typeLabel(item.type, locale)} {item.director ? `· ${locale === "da" ? "Instruktør" : "Director"}: ${item.director}` : ""}
                          </p>
                          {item.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
                        </div>
                      </button>
                      {selected && renderSelectedDetails?.(item)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasSearched && !isSearching && !searchError && results.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {t("works.noDatabaseMatchManualHint")}
            </div>
          )}

          <Button type="button" size="sm" variant="outline" onClick={enterManual}>
            {t("works.enterManually")}
          </Button>
        </>
      ) : (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{t("works.manualWorkData")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => onManualModeChange(false)}>
              {t("works.backToSearch")}
            </Button>
          </div>
          <ManualWorkFormFields value={manualWork} onChange={onManualWorkChange} locale={locale} />
          {manualExtra}
        </div>
      )}
    </div>
  );
}
