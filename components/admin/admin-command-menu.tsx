"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { FileText, Film, Loader2, Search, User, Users } from "lucide-react";
import { toast } from "sonner";
import { searchAdmin, type AdminSearchResult } from "@/app/actions/admin-search";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const icons = { rightsHolder: User, work: Film, contract: FileText, producer: Users };

export function AdminCommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(value => !value); }
    };
    document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) {
      requestId.current += 1;
      const clear = window.setTimeout(() => { setResults([]); setLoading(false); }, 0);
      return () => window.clearTimeout(clear);
    }
    const current = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      const result = await searchAdmin(query);
      if (current !== requestId.current) return;
      setLoading(false);
      if (!result.success) toast.error(result.error ?? "Søgningen fejlede"); else setResults(result.results);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  return <><button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-lg hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Åbn global adminsøgning"><Search className="h-4 w-4" /><span>Søg</span><kbd className="text-xs text-muted-foreground">⌘K</kbd></button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="overflow-hidden p-0 sm:max-w-xl"><DialogTitle className="sr-only">Global adminsøgning</DialogTitle><DialogDescription className="sr-only">Søg i rettighedshavere, værker, kontrakter og producenter.</DialogDescription><Command shouldFilter={false} className="bg-popover text-popover-foreground"><div className="flex items-center border-b px-3"><Search className="mr-2 h-4 w-4 text-muted-foreground" /><Command.Input value={query} onValueChange={setQuery} autoFocus placeholder="Søg i portalen…" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div><Command.List className="max-h-80 overflow-y-auto p-2"><Command.Empty className="p-6 text-center text-sm text-muted-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : query.length < 2 ? "Skriv mindst 2 tegn" : "Ingen resultater"}</Command.Empty>{results.map(result => { const Icon = icons[result.type]; return <Command.Item key={`${result.type}-${result.id}`} value={`${result.type}-${result.id}`} onSelect={() => { setOpen(false); router.push(result.href); }} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"><Icon className="h-4 w-4" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{result.title}</span><span className="block truncate text-xs text-muted-foreground">{result.context}</span></span></Command.Item>; })}</Command.List></Command></DialogContent></Dialog></>;
}
