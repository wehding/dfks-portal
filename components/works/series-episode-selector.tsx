"use client";

import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EpisodePicker } from "@/components/works/episode-picker";
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
}) {
  return (
    <div className="space-y-3">
      {showSeason && (
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sæson
          <Input
            type="number"
            min="1"
            value={season}
            onChange={event => onSeasonChange(Math.max(1, Number(event.target.value) || 1))}
            className="h-8 w-20"
          />
        </Label>
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
        <p className="text-xs text-amber-700">Der blev ikke fundet en sikker afsnitsliste for denne sæson.</p>
      )}
    </div>
  );
}
