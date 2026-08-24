"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export type LocalRightsHolderOption = {
  id: string;
  full_name: string;
};

type LocalRightsHolderAutocompleteProps = {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  excludedIds?: Array<string | null | undefined>;
  onValueChange: (value: string) => void;
  onSelect: (option: LocalRightsHolderOption) => void;
  inputClassName?: string;
  menuClassName?: string;
};

let cachedOptions: LocalRightsHolderOption[] | null = null;
let pendingOptions: Promise<LocalRightsHolderOption[]> | null = null;

function normalize(value: string) {
  return value
    .toLocaleLowerCase("da-DK")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function loadOptions() {
  if (cachedOptions) return cachedOptions;
  if (!pendingOptions) {
    pendingOptions = fetch("/api/portal/rights-holders", { cache: "no-store" })
      .then(async response => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Rettighedshavere kunne ikke hentes.");
        const nextOptions = Array.isArray(result.results) ? result.results : [];
        cachedOptions = nextOptions;
        return nextOptions;
      })
      .finally(() => {
        pendingOptions = null;
      });
  }
  return pendingOptions;
}

export function LocalRightsHolderAutocomplete({
  value,
  disabled,
  placeholder,
  excludedIds = [],
  onValueChange,
  onSelect,
  inputClassName,
  menuClassName,
}: LocalRightsHolderAutocompleteProps) {
  const [options, setOptions] = React.useState<LocalRightsHolderOption[]>(cachedOptions ?? []);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const ensureLoaded = React.useCallback(async () => {
    if (disabled || options.length > 0) return;
    setLoading(true);
    setError(null);
    try {
      setOptions(await loadOptions());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rettighedshavere kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }, [disabled, options.length]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onContextUpdated = () => {
      cachedOptions = null;
      pendingOptions = null;
      setOptions([]);
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("admin-context-updated", onContextUpdated);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("admin-context-updated", onContextUpdated);
    };
  }, []);

  const excluded = new Set(excludedIds.filter((id): id is string => Boolean(id)));
  const q = normalize(value);
  const matches = options
    .filter(option => !excluded.has(option.id))
    .filter(option => !q || normalize(option.full_name).includes(q))
    .slice(0, 10);

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={value}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          void ensureLoaded();
        }}
        onChange={event => {
          onValueChange(event.target.value);
          setOpen(true);
          void ensureLoaded();
        }}
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />
      {open && !disabled && (matches.length > 0 || loading || error) && (
        <div className={`absolute z-30 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md ${menuClassName ?? ""}`}>
          {loading && (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Henter rettighedshavere…
            </div>
          )}
          {error && <div className="px-2 py-2 text-sm text-destructive">{error}</div>}
          {!loading && !error && matches.map(option => (
            <button
              key={option.id}
              type="button"
              className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSelect(option);
                setOpen(false);
              }}
            >
              {option.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
