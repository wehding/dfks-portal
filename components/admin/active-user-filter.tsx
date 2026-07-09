"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActiveRightsHolder } from "@/lib/use-active-rights-holder";

type RightsHolderOption = { id: string; full_name: string };

type Props = {
  rightsHolders: RightsHolderOption[];
  activeRh: ActiveRightsHolder;
  onChange: (rh: ActiveRightsHolder) => void;
};

export function ActiveUserFilter({ rightsHolders, activeRh, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q
      ? rightsHolders.filter(rh => rh.full_name.toLowerCase().includes(q))
      : rightsHolders;
    return source.slice(0, 8);
  }, [query, rightsHolders]);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, []);

  if (activeRh) {
    return (
      <div className="flex min-h-10 w-full flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm sm:w-auto">
        <span className="text-muted-foreground">Aktiv rettighedshaver:</span>
        <span className="font-medium">{activeRh.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onChange(null)}
          aria-label="Ryd aktiv rettighedshaver"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-[280px]">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Filtrér på rettighedshaver..."
        className="pl-8"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {suggestions.map(rh => (
            <button
              key={rh.id}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onChange({ id: rh.id, name: rh.full_name });
                setQuery("");
                setOpen(false);
              }}
            >
              {rh.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
