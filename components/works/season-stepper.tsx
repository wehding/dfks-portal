"use client";

import { useId } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { normalizeSeasonNumber, seasonNumberForKey, stepSeasonNumber } from "@/lib/season-selection";

export function SeasonStepper({
  value,
  onChange,
  readOnly = false,
  compact = false,
  className = "",
}: {
  value: number;
  onChange?: (season: number) => void;
  readOnly?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const season = normalizeSeasonNumber(value);

  const update = (next: number) => {
    const normalized = normalizeSeasonNumber(next);
    onChange?.(normalized);
  };

  if (readOnly) {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <Label className="text-xs text-muted-foreground">{t("works.season")}</Label>
        <div className="flex h-8 w-24 items-center rounded-md border bg-muted/40 px-3 text-sm" aria-label={`${t("works.season")} ${season}`}>
          {season}
        </div>
      </div>
    );
  }

  const decrementLabel = t("works.previousSeason");
  const incrementLabel = t("works.nextSeason");

  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">{t("works.season")}</Label>
      <div className="flex items-stretch">
        <Input
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={season}
          aria-label={t("works.season")}
          onChange={event => {
            const digits = event.target.value.replace(/\D/g, "");
            if (digits) update(Number.parseInt(digits, 10));
          }}
          onKeyDown={event => {
            const next = seasonNumberForKey(season, event.key);
            if (next !== null) {
              event.preventDefault();
              update(next);
            }
          }}
          className={`${compact ? "h-8 w-16 text-xs" : "h-9 w-20"} rounded-r-none text-center`}
        />
        <div className="flex flex-col">
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={incrementLabel}
            title={incrementLabel}
            onClick={() => update(stepSeasonNumber(season, "up"))}
            className={`${compact ? "h-4 w-8" : "h-[18px] w-9"} rounded-l-none rounded-bl-none border-l-0`}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={decrementLabel}
            title={decrementLabel}
            disabled={season <= 1}
            onClick={() => update(stepSeasonNumber(season, "down"))}
            className={`${compact ? "h-4 w-8" : "h-[18px] w-9"} rounded-l-none rounded-tl-none border-l-0 border-t-0`}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
