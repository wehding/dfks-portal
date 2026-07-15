"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeriesEpisodeSelector } from "@/components/works/series-episode-selector";
import { useI18n } from "@/lib/i18n";
import { isManualSeries, type ManualWorkFormValue } from "@/lib/manual-work";
import { buildCompleteEpisodeOptions } from "@/lib/series-episodes";
import { WORK_TYPES } from "@/lib/work-types";

const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-input/30";

type Props = {
  value: ManualWorkFormValue;
  onChange: (value: ManualWorkFormValue) => void;
  locale: string;
};

export function ManualWorkFormFields({ value, onChange, locale }: Props) {
  const { t } = useI18n();
  const isSeries = isManualSeries(value);
  const episodeCount = Number.parseInt(value.episode_count, 10);
  const hasEpisodeCount = Number.isFinite(episodeCount) && episodeCount > 0;
  const update = <K extends keyof ManualWorkFormValue>(key: K, next: ManualWorkFormValue[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{t("works.titleField")}</Label>
          <Input value={value.title} onChange={event => update("title", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{t("works.typeField")}</Label>
          <select
            value={value.type}
            onChange={event => update("type", event.target.value)}
            className={selectCls}
          >
            {WORK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">
            {locale === "da" ? "Premiereår" : "Premiere year"} <span className="text-destructive">*</span>
          </Label>
          <Input
            required
            value={value.year}
            onChange={event => update("year", event.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="2026"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{t("works.durationField")}</Label>
          <Input value={value.duration_minutes} onChange={event => update("duration_minutes", event.target.value)} inputMode="numeric" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{locale === "da" ? "Produktionsselskab" : "Production company"}</Label>
          <Input value={value.production_company} onChange={event => update("production_company", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-muted-foreground">{locale === "da" ? "Instruktør" : "Director"}</Label>
          <Input value={value.director} onChange={event => update("director", event.target.value)} />
        </div>
      </div>

      {isSeries && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-muted-foreground">{t("works.season")}</Label>
              <Input
                type="number"
                min="1"
                placeholder="1"
                value={value.season_number}
                onChange={event => update("season_number", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-muted-foreground">{t("works.episodesField")}</Label>
              <Input
                value={value.episode_count}
                onChange={event => {
                  const nextCount = Number.parseInt(event.target.value, 10);
                  onChange({
                    ...value,
                    episode_count: event.target.value,
                    selected_episodes: Number.isFinite(nextCount)
                      ? value.selected_episodes.filter(number => number <= nextCount)
                      : [],
                  });
                }}
                inputMode="numeric"
              />
            </div>
          </div>

          {hasEpisodeCount ? (
            <SeriesEpisodeSelector
              season={Number(value.season_number) || 1}
              onSeasonChange={season => update("season_number", String(season))}
              options={buildCompleteEpisodeOptions({
                episodeCount,
                seasonNumber: Number(value.season_number) || 1,
              })}
              selected={value.selected_episodes}
              onSelectedChange={episodes => update("selected_episodes", episodes)}
              label={locale === "da" ? "Vælg de afsnit, du har arbejdet på" : "Select the episodes you worked on"}
              compact={false}
            />
          ) : (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-muted-foreground">{t("works.episode")}</Label>
              <Input
                type="number"
                min="1"
                placeholder="1"
                value={value.episode_number}
                onChange={event => update("episode_number", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {locale === "da"
                  ? "Hvis kontrakten ikke angiver et samlet antal afsnit, kan du vælge afsnittet manuelt."
                  : "If the contract does not specify a total episode count, enter the episode manually."}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("works.posterHint")}</p>
    </div>
  );
}
