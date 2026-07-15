"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

export type EpisodePickerOption = { number: number; title?: string | null };

export function episodeOptionLabel(option: EpisodePickerOption) {
  const base = `Afsnit ${option.number}`;
  const title = option.title?.trim();
  if (!title || title.toLowerCase() === base.toLowerCase()) return base;
  return `${base} – ${title}`;
}

export function EpisodePicker({ options, selected, onChange, label = "Vælg afsnit", compact = false }: {
  options: EpisodePickerOption[];
  selected: number[];
  onChange: (episodes: number[]) => void;
  label?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const toggle = (number: number) => onChange(selected.includes(number) ? selected.filter(item => item !== number) : [...selected, number].sort((a, b) => a - b));
  const resolvedLabel = label === "Vælg afsnit" ? t("works.selectEpisodes") : label;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm font-semibold">{resolvedLabel}</Label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(options.map(option => option.number))}>{t("common.selectAll")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([])}>{t("common.deselectAll")}</Button>
        </div>
      </div>
      <div className={`grid gap-2 overflow-y-auto ${compact ? "max-h-36 grid-cols-2 sm:grid-cols-4" : "max-h-48 grid-cols-2 sm:grid-cols-3"}`}>
        {options.map(option => {
          const active = selected.includes(option.number);
          return <button key={option.number} type="button" aria-pressed={active} onClick={() => toggle(option.number)} className={`rounded-md border px-2 py-2 text-left text-xs transition-colors ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>{episodeOptionLabel(option)}</button>;
        })}
      </div>
    </div>
  );
}
