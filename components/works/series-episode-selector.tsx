"use client";

import { Loader2 } from "lucide-react";
import { EpisodePicker } from "@/components/works/episode-picker";
import { SeasonStepper } from "@/components/works/season-stepper";
import { useI18n } from "@/lib/i18n";
import { seasonLookupMessage } from "@/lib/season-selection";
import type { SeriesEpisodeOption } from "@/lib/series-episodes";

export function SeriesEpisodeSelector({
  season,
  onSeasonChange,
  options,
  selected,
  onSelectedChange,
  loading = false,
  error = null,
  compact = true,
  label = "Vælg afsnit",
  showSeason = true,
  seasonReadOnly = false,
}: {
  season: number;
  onSeasonChange: (season: number) => void;
  options: SeriesEpisodeOption[];
  selected: number[];
  onSelectedChange: (episodes: number[]) => void;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
  label?: string;
  showSeason?: boolean;
  seasonReadOnly?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <div className="space-y-3">
      {showSeason && (
        <SeasonStepper value={season} onChange={onSeasonChange} readOnly={seasonReadOnly} compact={compact} />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Henter afsnit...
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : options.length > 0 ? (
        <EpisodePicker compact={compact} options={options} selected={selected} onChange={onSelectedChange} label={label} />
      ) : (
        <p className="text-xs text-amber-700">
          {seasonLookupMessage(locale, "not_found", season)}
        </p>
      )}
    </div>
  );
}
