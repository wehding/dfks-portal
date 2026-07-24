"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

type RightsHolderOption = { id: string; full_name: string };

export function RightsHolderAutocomplete({ options, value, onChange, placeholder = "Søg rettighedshaver…" }: {
  options: RightsHolderOption[];
  value?: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const selected = options.find(option => option.id === value);
  const [query, setQuery] = useState(selected?.full_name ?? "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("da");
    return options.filter(option => !normalized || option.full_name.toLocaleLowerCase("da").includes(normalized)).slice(0, 10);
  }, [options, query]);

  return <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
    <Input value={query} className="pl-9 pr-9" placeholder={placeholder} autoComplete="off" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={event => { setQuery(event.target.value); setOpen(true); if (value) onChange(""); }} />
    {query && <button type="button" className="absolute right-3 top-2.5 text-muted-foreground" aria-label="Ryd rettighedshaver" onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(""); onChange(""); }}><X className="h-4 w-4" /></button>}
    {open && <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {matches.length ? matches.map(option => <button key={option.id} type="button" className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-accent" onMouseDown={event => event.preventDefault()} onClick={() => { onChange(option.id); setQuery(option.full_name); setOpen(false); }}>{option.full_name}</button>) : <p className="px-2 py-3 text-sm text-muted-foreground">Ingen rettighedshavere fundet</p>}
    </div>}
  </div>;
}
